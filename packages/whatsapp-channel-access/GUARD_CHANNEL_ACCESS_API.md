# Guard Channel Access API

This document defines the preferred Guard backend contract for `@valuya/whatsapp-channel-access`.

It is designed to replace the current inference-only flow based on `GET /api/v2/entitlements` with a purpose-built channel access resolution endpoint that can express:

- free trial access
- paid access
- expired trial with payment required
- inactive access
- a payment CTA URL

## Why this endpoint

`GET /api/v2/entitlements` is still useful, but it is too narrow for a WhatsApp paid channel product because the runtime needs more than a yes/no entitlement check:

- explicit `trial_active`
- explicit `expired_payment_required`
- trial expiry timestamp
- a payment URL to recover access
- optional channel invite URL metadata

## Proposed endpoint

`POST /api/v2/channel-access/resolve`

This is a read-style resolution endpoint, but `POST` keeps the contract flexible for richer channel metadata and future policy inputs.

## Request

Headers:

- `Authorization: Bearer <tenant-token>`
- `Accept: application/json`
- `Content-Type: application/json`
- `X-Valuya-Subject-Id: <protocol-subject-header>`

Body:

```json
{
  "resource": "whatsapp:channel:meta:premium_alpha:49123456789",
  "plan": "standard",
  "channel": {
    "kind": "whatsapp",
    "provider": "meta",
    "channel_identifier": "premium_alpha",
    "phone_number": "49123456789"
  }
}
```

Notes:

- `resource` and `plan` are required
- `channel` is optional but recommended
- Guard should use `X-Valuya-Subject-Id` as the canonical subject input

## Response

### Paid access

```json
{
  "ok": true,
  "state": "paid_active",
  "resource": "whatsapp:channel:meta:premium_alpha:49123456789",
  "plan": "standard",
  "expires_at": "2026-06-30T23:59:59Z",
  "payment_url": null,
  "reason": "mandate_active"
}
```

### Trial active

```json
{
  "ok": true,
  "state": "trial_active",
  "resource": "whatsapp:channel:meta:premium_alpha:49123456789",
  "plan": "standard",
  "expires_at": "2026-03-31T23:59:59Z",
  "payment_url": "https://pay.example/checkout/ch_123",
  "reason": "trial_active"
}
```

### Trial expired, payment required

```json
{
  "ok": true,
  "state": "expired_payment_required",
  "resource": "whatsapp:channel:meta:premium_alpha:49123456789",
  "plan": "standard",
  "expires_at": "2026-03-01T00:00:00Z",
  "payment_url": "https://pay.example/checkout/ch_123",
  "reason": "trial_expired"
}
```

### Inactive

```json
{
  "ok": true,
  "state": "inactive",
  "resource": "whatsapp:channel:meta:premium_alpha:49123456789",
  "plan": "standard",
  "expires_at": null,
  "payment_url": "https://pay.example/checkout/ch_123",
  "reason": "no_mandate"
}
```

## State semantics

- `paid_active`
  - user has active paid channel access
- `trial_active`
  - user currently has free trial access
- `expired_payment_required`
  - user had trial access, but it expired and payment is now required
- `inactive`
  - user is linked but does not currently have access

## Fallback compatibility

If this endpoint is not available yet, `@valuya/whatsapp-channel-access` can keep using:

- `GET /api/v2/entitlements`

and infer:

- `paid_active` from `active: true`
- `trial_active` from `state: "trial_active"`
- `expired_payment_required` from `state: "expired_payment_required"`
- otherwise `inactive`

## Suggested backend behavior

Guard should evaluate channel access in this order:

1. explicit paid mandate for `resource + plan`
2. active trial mandate for `resource + plan`
3. expired trial mandate for `resource + plan`
4. inactive / no mandate

## Optional future fields

These are not required for Phase 1, but the endpoint can grow into them later:

```json
{
  "required_action": "pay_now",
  "mandate_id": "123",
  "product_id": "prod_channel_whatsapp_standard",
  "payment_session_id": "cs_123",
  "trial": {
    "started_at": "2026-03-01T00:00:00Z",
    "expires_at": "2026-03-31T23:59:59Z"
  }
}
```
