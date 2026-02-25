# frozen_string_literal: true

RSpec.describe ValuyaGuard::Middleware do
  let(:app) { ->(_env) { [200, { "Content-Type" => "application/json" }, ["{\"ok\":true}"]] } }

  before do
    ValuyaGuard.configure do |c|
      c.default_plan = "standard"
      c.default_resource = ""
      c.web_redirect = true
      c.subject_resolver = nil
      c.resource_resolver = nil
    end
  end

  it "allows request when entitlement is active" do
    client = double("client")
    allow(client).to receive(:entitlements).and_return({ "active" => true, "evaluated_plan" => "standard" })

    middleware = described_class.new(app, client: client)
    status, = middleware.call(Rack::MockRequest.env_for("/premium", "HTTP_X_VALUYA_SUBJECT_ID" => "user:1"))

    expect(status).to eq(200)
  end

  it "returns 302 for HTML requests when entitlement inactive" do
    client = double("client")
    allow(client).to receive(:entitlements).and_return({ "active" => false, "reason" => "subscription_inactive", "required" => { "type" => "subscription", "plan" => "standard" }, "evaluated_plan" => "standard" })
    allow(client).to receive(:create_checkout).and_return({ "session_id" => "cs_1", "payment_url" => "https://pay.example/cs_1" })

    middleware = described_class.new(app, client: client)
    env = Rack::MockRequest.env_for("/premium", "HTTP_ACCEPT" => "text/html", "HTTP_X_VALUYA_SUBJECT_ID" => "user:1")
    status, headers, _body = middleware.call(env)

    expect(status).to eq(302)
    expect(headers["Location"]).to eq("https://pay.example/cs_1")
  end

  it "returns canonical 402 JSON for API requests when entitlement inactive" do
    client = double("client")
    allow(client).to receive(:entitlements).and_return({ "active" => false, "reason" => "subscription_inactive", "required" => { "type" => "subscription", "plan" => "standard" }, "evaluated_plan" => "standard" })
    allow(client).to receive(:create_checkout).and_return({ "session_id" => "cs_1", "payment_url" => "https://pay.example/cs_1" })

    middleware = described_class.new(app, client: client)
    env = Rack::MockRequest.env_for("/premium", "HTTP_ACCEPT" => "application/json", "HTTP_X_VALUYA_SUBJECT_ID" => "user:1")
    status, _headers, body = middleware.call(env)

    expect(status).to eq(402)
    parsed = JSON.parse(body.join)
    expect(parsed["error"]).to eq("payment_required")
    expect(parsed["session_id"]).to eq("cs_1")
    expect(parsed["payment_url"]).to eq("https://pay.example/cs_1")
  end

  it "resolves resource as http route key by default" do
    client = double("client")
    expect(client).to receive(:entitlements).with(hash_including(resource: "http:route:GET:/premium")).and_return({ "active" => true })

    middleware = described_class.new(app, client: client)
    middleware.call(Rack::MockRequest.env_for("/premium", "REQUEST_METHOD" => "GET", "HTTP_X_VALUYA_SUBJECT_ID" => "user:1"))
  end
end
