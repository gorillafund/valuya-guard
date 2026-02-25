# frozen_string_literal: true

RSpec.describe ValuyaGuard::ControllerProtect do
  class DummyResponse
    attr_accessor :status, :headers

    def initialize
      @status = 200
      @headers = {}
    end
  end

  class DummyController
    include ValuyaGuard::ControllerProtect

    attr_reader :request, :response
    attr_accessor :response_body

    def initialize(env, middleware)
      @request = Rack::Request.new(env)
      @response = DummyResponse.new
      @middleware = middleware
    end

    private

    def valuya_middleware_for_controller(resource:, plan:)
      @middleware
    end
  end

  it "sets response when middleware denies" do
    deny_middleware = instance_double(ValuyaGuard::Middleware)
    allow(deny_middleware).to receive(:call).and_return([402, { "X-Test" => "1" }, ["{\"error\":\"payment_required\"}"]])

    controller = DummyController.new(Rack::MockRequest.env_for("/premium"), deny_middleware)
    result = controller.require_valuya_mandate(resource: "http:route:GET:/premium")

    expect(result).to eq(false)
    expect(controller.response.status).to eq(402)
    expect(controller.response.headers["X-Test"]).to eq("1")
  end
end
