# Telegram Payment-Gated Bot Template

Minimal template for a Telegram bot using `@valuya/telegram-bot`.

## Install

```bash
pnpm add telegraf @valuya/telegram-bot
```

## Env

```bash
TELEGRAM_BOT_TOKEN=...
VALUYA_BASE=https://pay.gorilla.build
VALUYA_TENANT_TOKEN=ttok_...
VALUYA_RESOURCE=telegram:bot:assistant:premium
VALUYA_PLAN=standard
```

## Run

```bash
tsx bot.ts
```

Commands:
- `/premium` -> access check + payment prompt
- `/status` -> entitlement re-check
