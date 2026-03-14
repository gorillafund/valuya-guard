# @valuya/whatsapp-bot-channel

`@valuya/whatsapp-bot-channel` is the first concrete gated WhatsApp channel example on top of Valuya Guard.

It is designed for channels that are:

- payment-gated by default
- either human-moderated or agent-moderated
- able to run a configurable "soul" for natural conversations
- able to keep useful conversational memory across turns

This package builds on `@valuya/whatsapp-channel-access` instead of reimplementing Guard access logic.

## What it does

- resolves channel access through Guard
- blocks unpaid/inactive users by default
- routes allowed users into:
  - `human` mode: gated human handoff
  - `agent` mode: soul-driven answers with memory
- supports configurable structured response schemas so different channel tasks can still feel natural

## Main pieces

- `WhatsAppBotChannel`
- `SchemaDrivenSoulRuntime`
- `FileSoulMemoryStore`
- `createMentorSoulDefinition`
- `WhatsAppBotChannelApp`
- `server.ts`

## Quick Start

1. Start from [`.env.example`](/home/colt/Software/valuya-guard/packages/whatsapp-bot-channel/.env.example).
2. Set the Guard values:
   - `VALUYA_BASE`
   - `VALUYA_TENANT_TOKEN`
   - `WHATSAPP_CHANNEL_APP_ID`
   - `WHATSAPP_CHANNEL_RESOURCE`
3. Choose:
   - `WHATSAPP_CHANNEL_MODE=human`
   - or `WHATSAPP_CHANNEL_MODE=agent`
4. If `agent`, set:
   - `WHATSAPP_CHANNEL_SOUL_SYSTEM_PROMPT`
   - and either:
     - `OPENAI_API_KEY`
     - or `WHATSAPP_CHANNEL_SOUL_PROVIDER=webhook|n8n|langchain|api` plus `WHATSAPP_CHANNEL_SOUL_WEBHOOK_URL`
   - optional `WHATSAPP_CHANNEL_SOUL_RESPONSE_SCHEMA_JSON`
5. Start it from the package folder:
   - `pnpm start`
6. Or use the repo-level launcher:
   - `pnpm gated-channel:launch --channel whatsapp --preset mentor --slug mentor_demo`

## Twilio Note

If you use the real Twilio webhook path, set these as well:
- `TWILIO_VALIDATE_SIGNATURE`
- `TWILIO_AUTH_TOKEN`
- `TWILIO_WEBHOOK_PUBLIC_URL`

If you only use `/internal/message` for demo injection, Twilio vars are not required.

## External AI Providers

Agent mode can run through:

- OpenAI directly
- `n8n`
- LangChain services
- any API-compatible orchestration service

Use:

- `WHATSAPP_CHANNEL_SOUL_PROVIDER=openai`
- or `WHATSAPP_CHANNEL_SOUL_PROVIDER=webhook`
- aliases also accepted:
  - `n8n`
  - `langchain`
  - `api`

Webhook settings:

- `WHATSAPP_CHANNEL_SOUL_WEBHOOK_URL`
- `WHATSAPP_CHANNEL_SOUL_WEBHOOK_AUTH_TOKEN`
- `WHATSAPP_CHANNEL_SOUL_WEBHOOK_TIMEOUT_MS`
- `WHATSAPP_CHANNEL_SOUL_WEBHOOK_HEADERS_JSON`

The external runtime receives the current message, memory, and soul/schema config, and returns either:

- plain text
- a structured JSON payload using the configured schema keys
- or a full `SoulResponse`-style object

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

## Typical Uses

- paid mentor channel
- coach or therapist-style reflective channel
- gated concierge
- premium human support line

## Starter Template

For the reusable rollout model, see:
- [gated-channel-starter-template.md](/home/colt/Software/valuya-guard/docs/gated-channel-starter-template.md)
- [gated-channel-demo-presets.md](/home/colt/Software/valuya-guard/docs/gated-channel-demo-presets.md)

## Mentor-style usage

The included mentor helper is meant for flows like:

- user shares a problem
- soul responds naturally
- soul asks the next deeper question
- memory keeps context so the next answer gets better

## Scope

This package is intentionally channel-focused.

It does not duplicate:

- subject resolution
- mandate/trial logic
- payment URL creation
- backend runtime authorization decisions

Those remain backend-owned through the channel-access contract.
