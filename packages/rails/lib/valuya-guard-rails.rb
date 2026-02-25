# frozen_string_literal: true

require_relative "valuya_guard"

# Backwards compatibility namespace
module Valuya
  module Guard
    module Rails
      Configuration = ::ValuyaGuard::Configuration
      Client = ::ValuyaGuard::Client
      Middleware = ::ValuyaGuard::Middleware
      ControllerHelper = ::ValuyaGuard::ControllerProtect

      class << self
        def configuration
          ::ValuyaGuard.configuration
        end

        def configure(&block)
          ::ValuyaGuard.configure(&block)
        end
      end
    end
  end
end

begin
  require "rails"

  module ValuyaGuard
    class Railtie < ::Rails::Railtie
      initializer "valuya_guard.middleware" do |app|
        app.middleware.use ::ValuyaGuard::Middleware
      end
    end
  end
rescue LoadError
  # Non-Rails runtime
end
