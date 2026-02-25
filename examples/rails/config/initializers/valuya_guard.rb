Valuya::Guard::Rails.configure do |c|
  c.base = ENV.fetch("VALUYA_BASE")
  c.tenant_token = ENV.fetch("VALUYA_TENANT_TOKEN")
  c.default_plan = ENV.fetch("VALUYA_PLAN", "standard")
end
