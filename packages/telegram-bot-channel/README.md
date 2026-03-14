# @valuya/telegram-bot-channel

`@valuya/telegram-bot-channel` is the Telegram companion to `@valuya/whatsapp-bot-channel`.

It provides a first concrete gated Telegram channel example with:

- Guard-gated access
- human or agent moderation
- schema-driven soul responses
- persistent conversational memory
- app-layer link interception for `/start <token>` and `LINK <token>`
- a simple internal message server entrypoint

This package builds on `@valuya/telegram-channel-access`.

## Main pieces

- `TelegramBotChannel`
- `TelegramBotChannelApp`
- `GuardTelegramChannelLinkResolver`
- `SchemaDrivenSoulRuntime`
- `FileSoulMemoryStore`
- `server.ts`

## Quick Start

1. Start from [`.env.example`](/home/colt/Software/valuya-guard/packages/telegram-bot-channel/.env.example).
2. Set the Guard values:
   - `VALUYA_BASE`
   - `VALUYA_TENANT_TOKEN`
   - `TELEGRAM_CHANNEL_APP_ID`
   - `TELEGRAM_CHANNEL_RESOURCE`
3. Choose:
   - `TELEGRAM_CHANNEL_MODE=human`
   - or `TELEGRAM_CHANNEL_MODE=agent`
4. If `agent`, set:
   - `TELEGRAM_CHANNEL_SOUL_SYSTEM_PROMPT`
   - and either:
     - `OPENAI_API_KEY`
     - or `TELEGRAM_CHANNEL_SOUL_PROVIDER=webhook|n8n|langchain|api` plus `TELEGRAM_CHANNEL_SOUL_WEBHOOK_URL`
   - optional `TELEGRAM_CHANNEL_SOUL_RESPONSE_SCHEMA_JSON`
5. Start it from the package folder:
   - `pnpm start`
6. Or use the repo-level launcher:
   - `pnpm gated-channel:launch --channel telegram --preset mentor --slug mentor_demo`

## Typical Uses

- paid mentor or coach bot
- premium Telegram community entrypoint
- gated human Q&A channel
- agent-moderated support channel

## External AI Providers

Agent mode can run through:

- OpenAI directly
- `n8n`
- LangChain services
- any API-compatible orchestration service

Use:

- `TELEGRAM_CHANNEL_SOUL_PROVIDER=openai`
- or `TELEGRAM_CHANNEL_SOUL_PROVIDER=webhook`
- aliases also accepted:
  - `n8n`
  - `langchain`
  - `api`

Webhook settings:

- `TELEGRAM_CHANNEL_SOUL_WEBHOOK_URL`
- `TELEGRAM_CHANNEL_SOUL_WEBHOOK_AUTH_TOKEN`
- `TELEGRAM_CHANNEL_SOUL_WEBHOOK_TIMEOUT_MS`
- `TELEGRAM_CHANNEL_SOUL_WEBHOOK_HEADERS_JSON`

See the shared contract in:
- [external-soul-runtime-webhook-contract.md](/home/colt/Software/valuya-guard/docs/external-soul-runtime-webhook-contract.md)

For a runnable local reference runtime:

```bash
pnpm gated-channel:runtime-demo
```

For `n8n`, use:
- [n8n-bot-channel-runtime-guide.md](/home/colt/Software/valuya-guard/docs/n8n-bot-channel-runtime-guide.md)

For LangChain-style runtimes, use:
- [langchain-bot-channel-runtime-guide.md](/home/colt/Software/valuya-guard/docs/langchain-bot-channel-runtime-guide.md)

For Python-first runtimes, use:
- [python-bot-channel-runtime-guide.md](/home/colt/Software/valuya-guard/docs/python-bot-channel-runtime-guide.md)

For a backend selection overview, use:
- [choose-bot-channel-runtime-backend.md](/home/colt/Software/valuya-guard/docs/choose-bot-channel-runtime-backend.md)

## Starter Template

For the reusable rollout model, see:
- [gated-channel-starter-template.md](/home/colt/Software/valuya-guard/docs/gated-channel-starter-template.md)
- [gated-channel-demo-presets.md](/home/colt/Software/valuya-guard/docs/gated-channel-demo-presets.md)
