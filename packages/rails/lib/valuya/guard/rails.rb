# frozen_string_literal: true

require_relative "rails/configuration"
require_relative "rails/client"
require_relative "rails/middleware"
require_relative "rails/controller_helper"
require_relative "rails/railtie"

module Valuya
  module Guard
    module Rails
      class << self
        attr_accessor :configuration
      end

      self.configuration = Configuration.new

      def self.configure
        yield(configuration)
      end
    end
  end
end
