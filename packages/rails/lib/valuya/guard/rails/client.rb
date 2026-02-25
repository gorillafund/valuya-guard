# frozen_string_literal: true

require "faraday"
require "json"

module Valuya
  module Guard
    module Rails
      class Client
        def initialize(config = Valuya::Guard::Rails.configuration)
          @config = config
          @conn = Faraday.new(url: @config.base) do |f|
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

        def checkout(subject_id:, resource:, plan:, required:)
          payload = {
            resource: resource,
            plan: plan,
            evaluated_plan: plan,
            subject: parse_subject(subject_id),
            principal: parse_subject(subject_id),
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
            "Authorization" => "Bearer #{@config.tenant_token}",
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
    end
  end
end
