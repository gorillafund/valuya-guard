# valuya-guard-rails

Rails adapter for Valuya Guard with:

- Rack middleware (`ValuyaGuard::Middleware`)
- Controller helper (`ValuyaGuard::ControllerProtect`)

## Install

```ruby
# Gemfile
gem "valuya-guard-rails"
```

```bash
bundle install
```

## Configure

Create `config/initializers/valuya_guard.rb`:

```ruby
ValuyaGuard.configure do |c|
  c.api_base = ENV.fetch("VALUYA_API_BASE", ENV.fetch("VALUYA_BASE"))
  c.site_token = ENV.fetch("VALUYA_SITE_TOKEN", ENV.fetch("VALUYA_TENANT_TOKEN"))
  c.default_plan = ENV.fetch("VALUYA_PLAN", "standard")
  c.default_resource = ENV["VALUYA_RESOURCE"]
  c.web_redirect = ENV.fetch("VALUYA_WEB_REDIRECT", "true") == "true"
  c.timeout_ms = ENV.fetch("VALUYA_TIMEOUT_MS", "10000").to_i
end
```

## Middleware usage

```ruby
# config/application.rb
config.middleware.use ValuyaGuard::Middleware
```

## Controller/action protection

```ruby
class PremiumController < ApplicationController
  include ValuyaGuard::ControllerProtect

  before_action -> { require_valuya_mandate(resource: "http:route:GET:/premium", plan: "standard") }, only: [:show]

  def show
    render json: { ok: true }
  end
end
```

## Behavior

- Entitlement active: request proceeds.
- Entitlement inactive:
  - HTML request: `302` redirect to `payment_url`.
  - API request: `402 payment_required` JSON.
- Transport/backend failure: fail closed with `503`.

## Tests

```bash
bundle exec rspec
bundle exec rspec spec/middleware_spec.rb
bundle exec rspec spec/controller_protect_spec.rb
```
