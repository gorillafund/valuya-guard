# Backend Proposal: WhatsApp Channel Access, Trial Mandates, and Soul-Ready Guard Resolution

## Purpose

This proposal defines the backend work needed to support `@valuya/whatsapp-channel-access` as a reusable WhatsApp channel platform for:

- gated WhatsApp channel access
- free trial access with expiry
- paid continuation after trial expiry
- merchant-configured human or agent channels
- agent "souls" with memory and read access to Valuya Guard state

This proposal is intentionally about **channel access and conversation runtime**, not Alfies order checkout.

## Problem

Today the channel-access packages rely mainly on:

- `GET /api/v2/entitlements`

That works for a simple yes/no access check, but it is not expressive enough for the product we want to build. The package needs to distinguish:

- user is linked but on a free trial
- user had a free trial and it expired
- user needs a payment CTA
- user has active paid access
- access is inactive for another reason

We also want a clean backend contract for merchants who run:

- a human-operated WhatsApp channel
- or an OpenAI-backed WhatsApp agent with a merchant-defined "soul"

## Goals

1. Support a WhatsApp channel as a Guard-gated product.
2. Support a trial-first mandate model with an explicit expiry.
3. Support a clean payment-required transition after trial expiry.
4. Return a stable access-state response for channel runtimes.
5. Keep the subject/resource/plan model aligned with existing Guard semantics.
6. Enable future agent souls to fetch Guard data through typed backend read tools.

## Non-goals

- redesigning the Guard payment protocol
- replacing `GET /api/v2/entitlements`
- Alfies marketplace checkout
- arbitrary backend write access for agents

## Recommended backend model

Each paid WhatsApp channel should be represented as a Guard resource, for example:

```text
whatsapp:channel:meta:premium_alpha:49123456789
```

Access should be determined against:

- `resource`
- `plan`
- `subject`

The backend should support two access-bearing states:

- `trial_active`
- `paid_active`

And two blocked states:

- `expired_payment_required`
- `inactive`

## Proposed endpoint

### `POST /api/v2/channel-access/resolve`

This should become the preferred backend endpoint for `@valuya/whatsapp-channel-access`.

### Why a new endpoint

The existing entitlement endpoint is still useful, but channel access needs richer semantics than:

- `active: true`
- `active: false`

The runtime needs:

- an explicit trial state
- trial expiry
- a payment URL
- a stable state machine for UX copy

## Request contract

### Headers

- `Authorization: Bearer <tenant-token>`
- `Accept: application/json`
- `Content-Type: application/json`
- `X-Valuya-Subject-Id: <protocol-subject-header>`

### Body

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

### Notes

- `resource` and `plan` are required
- `channel` is optional metadata, but recommended
- the canonical subject should come from `X-Valuya-Subject-Id`

## Response contract

### Paid active

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

### Expired, payment required

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

### `paid_active`

User currently has paid access to the channel.

### `trial_active`

User currently has free access through a time-limited trial mandate.

### `expired_payment_required`

User previously had trial access, but the trial expired and payment is now required.

### `inactive`

User is linked, but there is no active trial or paid mandate for the resource/plan.

## Mandate model recommendation

The cleanest model is to represent trial access as a first-class mandate state in backend logic, even if it is stored differently from a paid mandate.

Backend evaluation order should be:

1. active paid mandate for `resource + plan`
2. active trial mandate for `resource + plan`
3. expired trial mandate for `resource + plan`
4. inactive / no mandate

If the backend already computes access from mandates + entitlements, this endpoint can be a thin projection layer on top of that logic.

## Payment URL behavior

The response should include `payment_url` whenever the user does not currently have paid access and a checkout CTA can be shown.

Recommended behavior:

- `trial_active`
  - payment URL optional but useful
- `expired_payment_required`
  - payment URL strongly recommended
- `inactive`
  - payment URL recommended if a payment path exists

## Suggested implementation shape

### Backend service

Add a Guard-side service that resolves:

- subject
- resource
- plan
- trial state
- paid state
- payment recovery URL

Pseudo-shape:

```php
resolveChannelAccess(subjectId, resource, plan, channelMeta) => {
  state,
  expires_at,
  payment_url,
  reason
}
```

### Controller

Add a controller endpoint:

```text
POST /api/v2/channel-access/resolve
```

This should:

1. authenticate tenant token
2. read `X-Valuya-Subject-Id`
3. validate `resource` and `plan`
4. call the resolution service
5. return the normalized access response

## Backward compatibility

`@valuya/whatsapp-channel-access` already includes a fallback resolver that uses:

- `GET /api/v2/entitlements`

So rollout can be:

1. deploy new backend endpoint
2. switch the package to prefer `POST /api/v2/channel-access/resolve`
3. keep the entitlements-backed resolver as fallback during migration

## Merchant-configured souls

This proposal does not require the backend to execute agent conversations directly. The first version can keep soul execution in the channel runtime package.

What the backend should support for souls is read access to Guard data through typed endpoints or tool-safe services.

Recommended first read capabilities:

- current channel access state
- entitlements
- recent payments
- recent orders
- basic profile summary

This should be exposed through typed backend reads, not arbitrary route access by the soul.

## Recommended future endpoints

These are not required for Phase 1, but they fit the direction:

### `GET /api/v2/channel-access/current`

Read-only current access snapshot for a subject/resource/plan.

### `GET /api/v2/channel-access/history`

Access lifecycle history:

- trial started
- trial expired
- payment completed
- paid mandate active

### `POST /api/v2/channel-access/payment-link`

Optional helper if payment URL generation should be separated from resolution.

## Open questions for backend

1. Should trial access be represented as:
   - a dedicated trial mandate type
   - or a derived access state from product metadata + timestamps?
2. Should `payment_url` be returned directly by Guard, or should the client still create a checkout session separately?
3. Do we want a single generic `channel-access/resolve` endpoint for WhatsApp, Telegram, Discord, etc., or a WhatsApp-specific one first?

## Recommendation

Implement a **generic** Guard endpoint:

```text
POST /api/v2/channel-access/resolve
```

with channel metadata in the request body, and use it first for WhatsApp.

That gives us:

- one stable access contract
- support for trial and paid states
- clear payment CTA behavior
- a strong foundation for human and agent channel products

## Expected client impact

Once this endpoint exists, `@valuya/whatsapp-channel-access` can:

- stop inferring trial/payment-required states from entitlements
- show better onboarding and expiry messages
- support merchant-run human or agent channels with a stable Guard-backed access state machine

## Related files

- [GUARD_CHANNEL_ACCESS_API.md](/home/colt/Software/valuya-guard/packages/whatsapp-channel-access/GUARD_CHANNEL_ACCESS_API.md)
- [WhatsAppChannelAccessService.ts](/home/colt/Software/valuya-guard/packages/whatsapp-channel-access/src/access/WhatsAppChannelAccessService.ts)
- [GuardChannelMandateResolver.ts](/home/colt/Software/valuya-guard/packages/whatsapp-channel-access/src/access/GuardChannelMandateResolver.ts)
