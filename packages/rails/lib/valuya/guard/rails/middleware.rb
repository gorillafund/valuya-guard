# frozen_string_literal: true

require "json"

module Valuya
  module Guard
    module Rails
      class Middleware
        def initialize(app, options = {})
          @app = app
          @resource = options[:resource]
          @plan = options[:plan]
          @client = options[:client] || Client.new
        end

        def call(env)
          request = Rack::Request.new(env)
          resource = resolve_resource(request)
          plan = (@plan || Valuya::Guard::Rails.configuration.default_plan).to_s
          subject_id = request.get_header("HTTP_X_VALUYA_SUBJECT_ID").to_s
          subject_id = "anon:unknown" if subject_id.empty?

          ent = @client.entitlements(subject_id: subject_id, resource: resource, plan: plan)
          return @app.call(env) if ent["active"] == true

          required = ent["required"] || { "type" => "subscription", "plan" => plan }
          evaluated_plan = ent["evaluated_plan"] || plan
          checkout = @client.checkout(subject_id: subject_id, resource: resource, plan: evaluated_plan, required: required)

          session_id = checkout["session_id"].to_s
          payment_url = checkout["payment_url"].to_s

          if wants_html?(request) && Valuya::Guard::Rails.configuration.web_redirect && !payment_url.empty?
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
          explicit = @resource || Valuya::Guard::Rails.configuration.default_resource
          return explicit unless explicit.to_s.strip.empty?

          "http:route:#{request.request_method.upcase}:#{request.path}"
        end

        def wants_html?(request)
          request.get_header("HTTP_ACCEPT").to_s.downcase.include?("text/html")
        end
      end
    end
  end
end
