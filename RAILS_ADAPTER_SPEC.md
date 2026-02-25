# Rails Adapter Spec

## 1) Purpose & Scope

- Provide Rails-native Valuya Guard protection via Rack middleware and controller-level filters.
- Enforce canonical behavior: allow on active entitlement, otherwise checkout + redirect/402.
- Cover website paywalls, API monetization, and mixed Rails apps.
- Does not implement payment rails itself or redesign Valuya protocol.

## 2) Target Framework

- Ruby on Rails (Rack + controller filters)

## 3) Minimal Public API

- `ValuyaGuard.configure { |c| ... }`
- `ValuyaGuard::Middleware#initialize(app, resource: nil, plan: nil, client: nil)`
- `ValuyaGuard::Middleware#call(env)`
- `ValuyaGuard::ControllerProtect#require_valuya_mandate(resource:, plan: nil, web_redirect: nil)`
- `ValuyaGuard::Client#entitlements(subject_id:, resource:, plan:)`
- `ValuyaGuard::Client#create_checkout(subject_id:, resource:, plan:, required:, principal_id: nil)`
- `ValuyaGuard::Helpers.http_route_resource(request)`
- `ValuyaGuard::Helpers.infer_request_mode(request)`

## 4) Configuration

Required env:
- `VALUYA_API_BASE` (fallback: `VALUYA_BASE`)
- `VALUYA_SITE_TOKEN` (fallback: `VALUYA_TENANT_TOKEN`)

Optional env:
- `VALUYA_PLAN` (default: `standard`)
- `VALUYA_RESOURCE`
- `VALUYA_WEB_REDIRECT` (default: `true`)
- `VALUYA_TIMEOUT_MS` (default: `10000`)

Initializer:
- `config/initializers/valuya_guard.rb` with `ValuyaGuard.configure`.

## 5) Behavior

- HTML/web requests: default `302` redirect to `payment_url` when inactive.
- API/JSON requests: default `402 payment_required` JSON body when inactive.
- Resource extraction order:
  1. explicit middleware/filter argument
  2. config default resource
  3. `http:route:<METHOD>:<PATH>` fallback
- Subject extraction order:
  1. `X-Valuya-Subject-Id` header
  2. optional configured subject resolver
  3. `current_user` fallback (if available)
  4. `anon:unknown`

## 6) Usage Snippets

- `config.ru`:
  - `use ValuyaGuard::Middleware`
- Controller:
  - `include ValuyaGuard::ControllerProtect`
  - `before_action -> { require_valuya_mandate(resource: "http:route:GET:/premium", plan: "standard") }`
- API 402 handling:
  - inspect `status == 402`, parse `payment_url` + `session_id` from JSON.

## 7) Example App

- Folder: `examples/rails`
- Contains:
  - initializer config
  - protected controller action
  - README with env/run/expected behavior

## 8) Tests

Contract coverage:
- allow response path
- deny web => redirect path
- deny API => canonical 402 payload

Adapter-specific coverage:
- resource resolution fallback
- controller helper denial behavior

Commands:
- `bundle exec rspec`
- `bundle exec rspec spec/middleware_spec.rb`
- `bundle exec rspec spec/controller_protect_spec.rb`

## 9) Effort Estimate

- Size: M
- Risks:
  - accurate HTML vs API detection
  - current_user availability in middleware context
  - fail-closed behavior under upstream errors
