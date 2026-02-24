# Discord Bot Adapter (Detailed)

Package: `@valuya/discord-bot`

## What this adapter solves

For premium slash commands, you need a low-friction in-chat payment UX:

1. User runs premium command.
2. Bot checks entitlement.
3. If inactive, bot returns ephemeral payment message + link button.
4. User pays.
5. User retries command or runs `/status`.

The adapter standardizes this flow with one `gate(...)` call.

## Install

```bash
npm i @valuya/discord-bot discord.js
```

## Required configuration

- `VALUYA_BASE`
- `VALUYA_TENANT_TOKEN`
- deterministic resource key per premium command family

Recommended:

- `VALUYA_PLAN=standard`

## Basic integration

```ts
import { createDiscordGuard } from "@valuya/discord-bot"

const guard = createDiscordGuard({
  base: process.env.VALUYA_BASE!,
  tenantToken: process.env.VALUYA_TENANT_TOKEN!,
  defaultResource: "discord:bot:assistant:premium_chat",
  defaultPlan: "standard",
})
```

## Premium slash command flow

```ts
const decision = await guard.gate({ user: { id: interaction.user.id, username: interaction.user.username } })

if (decision.active) {
  await interaction.reply({ content: "Access granted.", ephemeral: true })
  return
}

await interaction.reply({
  content: `${decision.prompt.message}\n${decision.prompt.followupHint}`,
  ephemeral: true,
  components: [/* link button with decision.prompt.button.url */],
})
```

## Status flow

```ts
const status = await guard.status({ user: { id: interaction.user.id } })
await interaction.reply({
  content: status.active ? "Payment confirmed. Access active." : "No active access yet.",
  ephemeral: true,
})
```

## Subject and resource conventions

Default subject emitted by adapter:

```json
{ "type": "discord", "id": "<discord_user_id>" }
```

Recommended resource naming:

- `discord:bot:<bot_slug>:<feature_slug>`

Examples:

- `discord:bot:assistant:premium_chat`
- `discord:bot:assistant:priority_queue`

## Backend calls performed

On `gate(...)`:

1. `GET /api/v2/entitlements?plan=...&resource=...`
2. if inactive -> `POST /api/v2/checkout/sessions`

On `status(...)`:

1. `GET /api/v2/entitlements?plan=...&resource=...`

## UX best practices

- Use ephemeral responses for payment and status interactions.
- Keep one primary CTA button (`Pay Now`).
- Add `/status` command for user-controlled refresh.
- Keep premium command execution idempotent so retry is safe.
- Log `sessionId` and `resource` for support traces.

## Error handling

Adapter throws on HTTP/API failures. In slash command handlers:

- catch and send short retry message
- log full error server-side with request context

## Template

- `examples/discord-bot-template`
