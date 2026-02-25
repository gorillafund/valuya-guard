# Observability

## Tracing

- Propagate `X-Request-Id` across proxy -> gateway -> backend calls.
- Include request ID in adapter/gateway logs.

## Structured logging

Recommended log fields:

- `request_id`
- `resource`
- `plan`
- `subject_id`
- `decision` (`allow`, `deny_402`, `deny_redirect`, `error`)
- `session_id` (if checkout created)
- `latency_ms`

## Metrics hooks (recommended)

Track counters and latency histograms:

- `guard_entitlements_requests_total`
- `guard_checkout_requests_total`
- `guard_allow_total`
- `guard_deny_total`
- `guard_fail_closed_total`
- `guard_request_latency_ms`

## Health checks

Gateway provides:

- `GET /healthz`

Adapters should expose app-native health endpoints where possible.

## Circuit breaker guidance

- Keep upstream timeout bounded.
- Limit retries (1-2).
- Prefer fail-closed on repeated upstream failures.
- Consider short-lived local suppression only if product requirements explicitly permit degraded behavior.
