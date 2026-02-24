# Telegram Bot Adapter (Detailed)

Package: `@valuya/telegram-bot`

## What this adapter solves

Telegram premium commands need a fast and understandable user loop:

1. User tries premium command.
2. Bot checks entitlement.
3. If inactive, bot gives a one-click payment link.
4. User pays.
5. User re-runs command or checks `/status`.

The adapter gives that as a reusable guard API, so each command does not reimplement checkout logic.

## Install

```bash
npm i @valuya/telegram-bot telegraf
```

## Required configuration

- `VALUYA_BASE`
- `VALUYA_TENANT_TOKEN`
- deterministic resource key per feature (for example `telegram:bot:assistant:premium_chat`)

Recommended:

- `VALUYA_PLAN=standard`

## Basic integration

```ts
import { createTelegramGuard } from "@valuya/telegram-bot"

const guard = createTelegramGuard({
  base: process.env.VALUYA_BASE!,
  tenantToken: process.env.VALUYA_TENANT_TOKEN!,
  defaultResource: "telegram:bot:assistant:premium_chat",
  defaultPlan: "standard",
})
```

## Premium command flow

```ts
const decision = await guard.gate({ user: { id: ctx.from!.id, username: ctx.from!.username } })

if (decision.active) {
  await ctx.reply("Access granted. Running premium action.")
  return
}

await ctx.reply(decision.prompt.text, {
  reply_markup: {
    inline_keyboard: [[{ text: decision.prompt.keyboard[0].text, url: decision.prompt.keyboard[0].url }]],
  },
})
```

## Status command flow

```ts
const status = await guard.status({ user: { id: ctx.from!.id } })
await ctx.reply(status.active ? "Payment confirmed. Access active." : "No active access yet.")
```

## Subject and resource conventions

Default subject emitted by adapter:

```json
{ "type": "telegram", "id": "<telegram_user_id>" }
```

Recommended resource naming:

- `telegram:bot:<bot_slug>:<feature_slug>`

Examples:

- `telegram:bot:assistant:premium_chat`
- `telegram:bot:assistant:daily_report`

## Backend calls performed

On `gate(...)`:

1. `GET /api/v2/entitlements?plan=...&resource=...`
2. if inactive -> `POST /api/v2/checkout/sessions`

On `status(...)`:

1. `GET /api/v2/entitlements?plan=...&resource=...`

Client does not synthesize pricing details; backend returns required/payment context.

## UX best practices

- Keep prompt text short and procedural.
- Always provide a direct button URL, not text-only link.
- Add `/status` command to reduce user confusion after payment.
- Apply short debounce per user (for example 3-5 seconds) to avoid duplicate session spam.
- Reuse the same resource key across retries to keep entitlements deterministic.

## Error handling

Adapter throws on HTTP/API failures. In your command handlers:

- catch errors
- return user-friendly retry message
- log technical context (`subject`, `resource`, `plan`, error code)

## Template

- `examples/telegram-bot-template`
