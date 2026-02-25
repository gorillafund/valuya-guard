# Rails Example (Protected Route)

This example shows one protected endpoint using `valuya-guard-rails`.

## Files

- `config/initializers/valuya_guard.rb`
- `app/controllers/premium_controller.rb`

## Env

```bash
export VALUYA_API_BASE="https://pay.gorilla.build"
export VALUYA_SITE_TOKEN="ttok_..."
export VALUYA_PLAN="standard"
```

## Run locally

```bash
bundle install
bin/rails s
```

## Expected behavior

- Browser request without entitlement => `302` redirect to checkout `payment_url`
- API request without entitlement => `402 payment_required` JSON with `session_id` and `payment_url`
- Entitled subject => `200` from action
