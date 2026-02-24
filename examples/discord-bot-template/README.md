# Discord Payment-Gated Bot Template

Minimal template for a Discord slash-command bot using `@valuya/discord-bot`.

## Install

```bash
pnpm add discord.js @valuya/discord-bot
```

## Env

```bash
DISCORD_BOT_TOKEN=...
VALUYA_BASE=https://pay.gorilla.build
VALUYA_TENANT_TOKEN=ttok_...
VALUYA_RESOURCE=discord:bot:assistant:premium
VALUYA_PLAN=standard
```

## Run

```bash
tsx bot.ts
```

Commands expected:
- `/premium` -> gated premium action
- `/status` -> entitlement status
