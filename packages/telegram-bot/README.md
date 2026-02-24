# @valuya/telegram-bot

Telegram adapter for payment-gated bots with Valuya Guard.

This package gives you a high-UX gate flow for commands:

1. Check entitlement (`/api/v2/entitlements`)
2. If missing, create checkout (`/api/v2/checkout/sessions`)
3. Return a ready payment prompt (text + Pay button)
4. User pays and retries command (or `/status`)

## Install

```bash
npm i @valuya/telegram-bot
```

## Quick start

```ts
import { createTelegramGuard } from "@valuya/telegram-bot"

const guard = createTelegramGuard({
  base: process.env.VALUYA_BASE!,
  tenantToken: process.env.VALUYA_TENANT_TOKEN!,
  defaultPlan: "standard",
  defaultResource: "telegram:bot:premium",
})

const decision = await guard.gate({ user: { id: 12345 } })
if (decision.active) {
  // allow premium action
} else {
  // send decision.prompt.text + decision.prompt.keyboard[0].url
}
```

## Recommended UX flow

- On premium command:
  - call `guard.gate(...)`
  - if active: execute command immediately
  - if not active: send payment prompt with a direct button link
- Add `/status` command:
  - call `guard.status(...)`
  - if active: confirm access is now enabled
  - if not active: remind user to complete payment
- Keep prompts short and actionable.

## Subject strategy

Default subject type is `telegram`, and subject id is `telegram_user_id`.

Example wire subject:

```json
{ "type": "telegram", "id": "12345" }
```

You can override `subjectType` if your backend expects a different type.

## API

### `createTelegramGuard(options)`

Options:
- `base` (required)
- `tenantToken` (required)
- `defaultPlan` (optional, default `pro`)
- `defaultResource` (optional)
- `subjectType` (optional, default `telegram`)
- `successUrl` / `cancelUrl` (optional)

Returns:
- `gate(input)`
- `status(input)`

### `gate(input)`

Input:
- `user.id` (required)
- `resource` (optional if `defaultResource` is set)
- `plan` (optional)

Result:
- active access: `{ active: true, ... }`
- payment required: `{ active: false, paymentUrl, sessionId, prompt, ... }`

### `status(input)`

Checks current entitlement status only.

## Production tips

- Set deterministic resource keys (`telegram:bot:<feature>`).
- Use one resource per premium capability.
- Use typed backend product authoring (`prepare`) to avoid resource drift.
- Add command cooldown/debounce to avoid repeated session creation spam.
- Log `sessionId` in bot logs for support and observability.
