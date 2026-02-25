# Rails Adapter

Gem: `valuya-guard-rails`

## Public API

- `ValuyaGuard::Middleware`
- `ValuyaGuard::ControllerProtect`
- `ValuyaGuard.configure { |c| ... }`

## Default behavior

- HTML/web requests: redirect (`302`) to `payment_url`
- JSON/API requests: return canonical `402 payment_required`

## Required env

- `VALUYA_API_BASE` (or `VALUYA_BASE`)
- `VALUYA_SITE_TOKEN` (or `VALUYA_TENANT_TOKEN`)

## Quick usage

```ruby
config.middleware.use ValuyaGuard::Middleware
```

```ruby
include ValuyaGuard::ControllerProtect
before_action -> { require_valuya_mandate(resource: "http:route:GET:/premium", plan: "standard") }
```
