# Payment Flows

## Canonical check flow

1. Adapter computes deterministic `resource` and `plan`.
2. Adapter resolves subject from `X-Valuya-Subject-Id` or fallback.
3. Adapter calls `GET /api/v2/entitlements`.
4. If active => request allowed.
5. If inactive => adapter creates session via `POST /api/v2/checkout/sessions`.
6. Adapter returns:
   - web/html => redirect to `payment_url`
   - api/json => canonical `402 payment_required` payload.

## Agent flow

1. Resolve context (`whoami`, `products/resolve`).
2. Create session.
3. Submit tx proof.
4. Verify session.
5. Execute optional `access.invoke`.

## Error policy

- Fail closed: upstream Valuya transport or 5xx errors must not silently allow requests.
- Include machine-readable error in JSON responses.
