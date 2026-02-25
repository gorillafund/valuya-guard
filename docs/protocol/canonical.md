# Valuya Guard Canonical Contract (v2)

Status: Canonical (Phase 0 alignment)
Version: 2026-02-25

This document is the single source of truth for request/response shapes used by:

- server adapters
- SDKs (`@valuya/agent`, `@valuya/core`)
- examples
- OpenAPI (`openapi/v2.yaml`)

## 1) Transport + Auth

- Base URL: tenant backend, e.g. `https://pay.gorilla.build`
- Content type: `application/json`
- Auth: `Authorization: Bearer <tenant_or_agent_token>` when required

## 2) Deterministic identifiers

- Subject header (canonical): `X-Valuya-Subject-Id: <type>:<id>`
- Resource format: `namespace:kind:identifier` (or route form `http:route:<METHOD>:<PATH>`)
- Plan: string, server-evaluated as `evaluated_plan`

## 3) Entitlements check

Endpoint:
- `GET /api/v2/entitlements?plan=<plan>&resource=<resource>`

Required headers:
- `X-Valuya-Subject-Id`

Legacy-compatible headers (optional, accepted while migrating):
- `X-Valuya-Subject-Type`
- `X-Valuya-Subject-Id-Raw`

Success (allow):

```json
{
  "active": true,
  "evaluated_plan": "standard",
  "expires_at": "2026-03-01T00:00:00Z"
}
```

Success (deny):

```json
{
  "active": false,
  "reason": "subscription_inactive",
  "required": { "type": "subscription", "plan": "standard" },
  "evaluated_plan": "standard",
  "anchor_resource": "http:route:GET:/premium"
}
```

## 4) Checkout session creation

Endpoint:
- `POST /api/v2/checkout/sessions`

Canonical request:

```json
{
  "resource": "http:route:GET:/premium",
  "plan": "standard",
  "evaluated_plan": "standard",
  "subject": { "type": "user", "id": "123" },
  "principal": { "type": "user", "id": "123" },
  "required": { "type": "subscription", "plan": "standard" },
  "mode": "agent",
  "origin": "https://app.example.com",
  "quantity_requested": 1
}
```

Response (minimum):

```json
{
  "session_id": "cs_...",
  "payment_url": "https://..."
}
```

Agent response extension (when used by agent payment flow):
- `anchor_resource`
- `required_hash`
- `pricing_hash`
- `quantity_effective`
- `payment`
- `server_time`
- `agent_proof_ttl_seconds`

## 5) Payment-required response semantics

API clients:
- return HTTP `402`
- JSON body:

```json
{
  "error": "payment_required",
  "reason": "subscription_inactive",
  "required": { "type": "subscription", "plan": "standard" },
  "evaluated_plan": "standard",
  "resource": "http:route:GET:/premium",
  "session_id": "cs_...",
  "payment_url": "https://..."
}
```

Web clients:
- adapters MAY return HTTP `302` redirect to `payment_url` when `Accept` includes `text/html`

## 6) Agent tx submit + verify

Submit tx:
- `POST /api/v2/agent/sessions/{session_id}/tx`

Request:

```json
{
  "wallet_address": "0x...",
  "tx_hash": "0x...",
  "signature": "0x...",
  "proof": {}
}
```

Verify:
- `POST /api/v2/agent/sessions/{session_id}/verify`

Request:

```json
{ "wallet_address": "0x..." }
```

## 7) Agent context + product resolution

- `GET /api/v2/agent/whoami`
- `POST /api/v2/agent/products/resolve`
- `GET /api/v2/agent/products/types`
- `GET /api/v2/agent/products/schema/{type}`
- `POST /api/v2/agent/products/prepare`

Canonical `prepare` request shape:

```json
{ "draft": { "type": "...", "name": "...", "access": {} } }
```

Legacy compatibility:
- raw payload without `draft` may be accepted during migration

## 8) Error envelope

Canonical error envelope:

```json
{
  "ok": false,
  "error": "product_not_found",
  "message": "Optional human-readable message",
  "request_id": "trace-id",
  "details": {}
}
```

Known machine codes:
- `tenant_token_required`
- `principal_not_bound`
- `subject_required`
- `invalid_request`
- `invalid_product_ref`
- `product_not_found`
- `insufficient_scope`
- `payment_required`
- `session_not_found`
- `session_expired`
- `invalid_signature`
- `wallet_not_allowlisted`
- `tx_hash_reused`

## 9) Compatibility policy

Backwards compatible:
- add optional fields
- add endpoints
- add error codes

Breaking:
- rename/remove required fields
- change existing semantic meaning

Deprecated but still supported (current):
- split subject headers (`X-Valuya-Subject-Type`, `X-Valuya-Subject-Id-Raw`)
- `prepare` raw body (without `draft`) during migration window
