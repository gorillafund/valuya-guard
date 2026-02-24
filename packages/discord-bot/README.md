# @valuya/discord-bot

Discord adapter for payment-gated bots with Valuya Guard.

## What it does

For slash commands or message commands, the adapter provides a predictable gate flow:

1. Check entitlement
2. If inactive, create checkout session
3. Return a UX-ready payment prompt payload (`message`, `button`, follow-up hint)
4. User pays and retries command

## Install

```bash
npm i @valuya/discord-bot
```

## Quick start

```ts
import { createDiscordGuard } from "@valuya/discord-bot"

const guard = createDiscordGuard({
  base: process.env.VALUYA_BASE!,
  tenantToken: process.env.VALUYA_TENANT_TOKEN!,
  defaultPlan: "standard",
  defaultResource: "discord:bot:premium",
})

const decision = await guard.gate({ user: { id: interaction.user.id } })
if (decision.active) {
  // execute premium command
} else {
  // show payment button using decision.prompt.button.url
}
```

## UX recommendations

- Keep payment prompts ephemeral for slash commands.
- Always include one-click `Pay Now` button.
- Provide `/status` command to reduce support friction.
- Cache recent pending sessions per user to avoid duplicate checkout creation.

## Subject strategy

Default subject is:

```json
{ "type": "discord", "id": "<discord_user_id>" }
```

Override `subjectType` if your backend uses a different mapping.
