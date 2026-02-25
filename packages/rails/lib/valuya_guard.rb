# frozen_string_literal: true

require "json"
require "faraday"
require "rack"

module ValuyaGuard
  class Configuration
    attr_accessor :api_base, :site_token, :default_plan, :default_resource,
                  :web_redirect, :timeout_ms, :resource_resolver, :subject_resolver

    def initialize
      @api_base = ENV.fetch("VALUYA_API_BASE", ENV.fetch("VALUYA_BASE", ""))
      @site_token = ENV.fetch("VALUYA_SITE_TOKEN", ENV.fetch("VALUYA_TENANT_TOKEN", ""))
      @default_plan = ENV.fetch("VALUYA_PLAN", "standard")
      @default_resource = ENV.fetch("VALUYA_RESOURCE", "")
      @web_redirect = ENV.fetch("VALUYA_WEB_REDIRECT", "true") == "true"
      @timeout_ms = ENV.fetch("VALUYA_TIMEOUT_MS", "10000").to_i
      @resource_resolver = nil
      @subject_resolver = nil
    end
  end

  class << self
    attr_accessor :configuration
  end

  self.configuration = Configuration.new

  def self.configure
    yield(configuration)
  end

  module Helpers
    module_function

    def http_route_resource(request)
      "http:route:#{request.request_method.upcase}:#{request.path}"
    end

    def infer_request_mode(request)
      accept = request.get_header("HTTP_ACCEPT").to_s.downcase
      return :html if accept.include?("text/html") && !accept.include?("application/json")

      :api
    end
  end

  class Client
    def initialize(config = ValuyaGuard.configuration)
      @config = config
      @conn = Faraday.new(url: @config.api_base) do |f|
        f.options.timeout = [@config.timeout_ms, 1000].max / 1000.0
      end
    end

    def entitlements(subject_id:, resource:, plan:)
      response = @conn.get("/api/v2/entitlements") do |req|
        req.headers.merge!(headers(subject_id))
        req.params["resource"] = resource
        req.params["plan"] = plan
      end
      decode!(response, "valuya_entitlements_failed")
    end

    def create_checkout(subject_id:, resource:, plan:, required:, principal_id: nil)
      payload = {
        resource: resource,
        plan: plan,
        evaluated_plan: plan,
        subject: parse_subject(subject_id),
        principal: parse_subject(principal_id || subject_id),
        required: required,
        mode: "agent"
      }

      response = @conn.post("/api/v2/checkout/sessions") do |req|
        req.headers.merge!(headers(subject_id).merge("Content-Type" => "application/json"))
        req.body = JSON.generate(payload)
      end

      decode!(response, "valuya_checkout_failed")
    end

    private

    def headers(subject_id)
      {
        "Accept" => "application/json",
        "Authorization" => "Bearer #{@config.site_token}",
        "X-Valuya-Subject-Id" => subject_id
      }
    end

    def decode!(response, prefix)
      if response.status >= 400
        raise "#{prefix}:#{response.status}:#{response.body.to_s[0, 300]}"
      end
      JSON.parse(response.body.to_s)
    end

    def parse_subject(subject_id)
      type, id = subject_id.to_s.split(":", 2)
      { type: type || "anon", id: id || "unknown" }
    end
  end

  class Middleware
    def initialize(app, resource: nil, plan: nil, client: nil)
      @app = app
      @resource = resource
      @plan = plan
      @client = client || Client.new
    end

    def call(env)
      request = Rack::Request.new(env)

      resource = resolve_resource(request)
      plan = (@plan || ValuyaGuard.configuration.default_plan).to_s
      subject_id = resolve_subject_id(request, env)

      ent = @client.entitlements(subject_id: subject_id, resource: resource, plan: plan)
      return @app.call(env) if ent["active"] == true

      required = ent["required"] || { "type" => "subscription", "plan" => plan }
      evaluated_plan = ent["evaluated_plan"] || plan
      checkout = @client.create_checkout(
        subject_id: subject_id,
        resource: resource,
        plan: evaluated_plan,
        required: required,
        principal_id: subject_id
      )

      session_id = checkout["session_id"].to_s
      payment_url = checkout["payment_url"].to_s

      if Helpers.infer_request_mode(request) == :html && ValuyaGuard.configuration.web_redirect && !payment_url.empty?
        return [302, { "Location" => payment_url, "X-Valuya-Session-Id" => session_id }, []]
      end

      body = {
        error: "payment_required",
        reason: ent["reason"] || "payment_required",
        required: required,
        evaluated_plan: evaluated_plan,
        resource: resource,
        session_id: session_id,
        payment_url: payment_url
      }

      [
        402,
        {
          "Content-Type" => "application/json; charset=utf-8",
          "Cache-Control" => "no-store",
          "X-Valuya-Session-Id" => session_id,
          "X-Valuya-Payment-Url" => payment_url,
          "Access-Control-Expose-Headers" => "X-Valuya-Payment-Url, X-Valuya-Session-Id"
        },
        [JSON.generate(body)]
      ]
    rescue StandardError => e
      [503, { "Content-Type" => "application/json" }, [JSON.generate({ ok: false, error: "valuya_guard_unavailable", message: e.message })]]
    end

    private

    def resolve_resource(request)
      return @resource unless @resource.to_s.strip.empty?

      cfg = ValuyaGuard.configuration
      return cfg.resource_resolver.call(request) if cfg.resource_resolver.respond_to?(:call)
      return cfg.default_resource unless cfg.default_resource.to_s.strip.empty?

      Helpers.http_route_resource(request)
    end

    def resolve_subject_id(request, env)
      explicit = request.get_header("HTTP_X_VALUYA_SUBJECT_ID").to_s
      return explicit unless explicit.empty?

      cfg = ValuyaGuard.configuration
      controller = env["action_controller.instance"]
      if cfg.subject_resolver.respond_to?(:call)
        resolved = cfg.subject_resolver.call(request, controller)
        return resolved.to_s unless resolved.to_s.empty?
      end

      if controller && controller.respond_to?(:current_user) && controller.current_user
        id = controller.current_user.respond_to?(:id) ? controller.current_user.id : nil
        return "user:#{id}" if id
      end

      anon = request.get_header("HTTP_X_VALUYA_ANON_ID").to_s
      anon = "unknown" if anon.empty?
      "anon:#{anon}"
    end
  end

  module ControllerProtect
    def require_valuya_mandate(resource:, plan: nil, web_redirect: nil)
      middleware = valuya_middleware_for_controller(resource: resource, plan: plan)
      original = ValuyaGuard.configuration.web_redirect
      ValuyaGuard.configuration.web_redirect = web_redirect unless web_redirect.nil?

      status, headers, body = middleware.call(request.env.merge("action_controller.instance" => self))
      return true if status == 200

      response.status = status
      headers.each { |k, v| response.headers[k] = v }
      self.response_body = body
      false
    ensure
      ValuyaGuard.configuration.web_redirect = original unless web_redirect.nil?
    end

    private

    def valuya_middleware_for_controller(resource:, plan:)
      ValuyaGuard::Middleware.new(->(_env) { [200, {}, []] }, resource: resource, plan: plan)
    end
  end
end
