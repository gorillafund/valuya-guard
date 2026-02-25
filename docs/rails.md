# Rails Adapter

Gem: `valuya-guard-rails`

- Rack middleware for global protection
- `require_valuya_mandate` helper for per-controller/per-action checks

Defaults:
- HTML => redirect to payment_url
- JSON/API => 402 payment_required
