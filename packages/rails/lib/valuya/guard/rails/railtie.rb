# frozen_string_literal: true

module Valuya
  module Guard
    module Rails
      class Railtie < ::Rails::Railtie
        initializer "valuya.guard.middleware" do |app|
          app.middleware.use Valuya::Guard::Rails::Middleware
        end
      end
    end
  end
end
