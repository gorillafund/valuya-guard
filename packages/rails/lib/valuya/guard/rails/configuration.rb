# frozen_string_literal: true

module Valuya
  module Guard
    module Rails
      class Configuration
        attr_accessor :base, :tenant_token, :default_plan, :default_resource, :web_redirect, :timeout_ms

        def initialize
          @base = ENV.fetch("VALUYA_BASE", "")
          @tenant_token = ENV.fetch("VALUYA_TENANT_TOKEN", ENV.fetch("VALUYA_SITE_TOKEN", ""))
          @default_plan = ENV.fetch("VALUYA_PLAN", "standard")
          @default_resource = ENV.fetch("VALUYA_RESOURCE", "")
          @web_redirect = ENV.fetch("VALUYA_WEB_REDIRECT", "true") == "true"
          @timeout_ms = ENV.fetch("VALUYA_TIMEOUT_MS", "10000").to_i
        end
      end
    end
  end
end
