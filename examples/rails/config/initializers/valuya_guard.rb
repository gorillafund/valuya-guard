ValuyaGuard.configure do |c|
  c.api_base = ENV.fetch("VALUYA_API_BASE", ENV.fetch("VALUYA_BASE"))
  c.site_token = ENV.fetch("VALUYA_SITE_TOKEN", ENV.fetch("VALUYA_TENANT_TOKEN"))
  c.default_plan = ENV.fetch("VALUYA_PLAN", "standard")
  c.web_redirect = ENV.fetch("VALUYA_WEB_REDIRECT", "true") == "true"
end
