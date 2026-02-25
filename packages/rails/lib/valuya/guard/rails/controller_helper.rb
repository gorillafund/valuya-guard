# frozen_string_literal: true

module Valuya
  module Guard
    module Rails
      module ControllerHelper
        def require_valuya_mandate(resource:, plan: nil)
          middleware = Valuya::Guard::Rails::Middleware.new(->(_env) { [200, {}, []] }, resource: resource, plan: plan)
          status, headers, body = middleware.call(request.env)
          return if status == 200

          response.status = status
          headers.each { |k, v| response.headers[k] = v }
          self.response_body = body
        end
      end
    end
  end
end
