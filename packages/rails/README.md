# valuya-guard-rails

Rack middleware + controller helper for Valuya Guard in Rails.

## Install

```ruby
gem "valuya-guard-rails"
```

## Configure

```ruby
# config/initializers/valuya_guard.rb
Valuya::Guard::Rails.configure do |c|
  c.base = ENV["VALUYA_BASE"]
  c.tenant_token = ENV["VALUYA_TENANT_TOKEN"]
  c.default_plan = "standard"
end
```

## Controller helper

```ruby
include Valuya::Guard::Rails::ControllerHelper
before_action -> { require_valuya_mandate(resource: "http:route:GET:/premium", plan: "standard") }
```
