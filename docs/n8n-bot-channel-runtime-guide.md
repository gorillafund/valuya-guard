# n8n Bot Channel Runtime Guide

This is the fastest no-code route for powering a gated WhatsApp or Telegram channel with an external runtime.

Use this when you want:

- `n8n` to generate the reply
- Guard to keep access/payment authority
- the channel packages to keep transport, memory, and gating behavior

## What to import

Reference workflow export:

- [n8n-valuya-bot-channel-runtime.json](/home/colt/Software/valuya-guard/docs/examples/n8n-valuya-bot-channel-runtime.json)

This flow contains:

- `Webhook`
- `Build Structured Reply`
- `Respond to Webhook`

It expects the same request contract documented in:

- [external-soul-runtime-webhook-contract.md](/home/colt/Software/valuya-guard/docs/external-soul-runtime-webhook-contract.md)

## What the flow does

1. receives the bot-channel webhook payload
2. reads:
   - `message`
   - `memory`
   - `soul`
   - `soul.responseSchema`
3. detects a simple root pattern
4. returns a structured JSON response using the requested schema keys

That means the same flow can serve:

- mentor
- support
- concierge

as long as the schema keys are provided by the channel config.

## Configure WhatsApp

Example:

```env
WHATSAPP_CHANNEL_MODE=agent
WHATSAPP_CHANNEL_SOUL_PROVIDER=n8n
WHATSAPP_CHANNEL_SOUL_WEBHOOK_URL=https://your-n8n.example/webhook/valuya-bot-channel-runtime
WHATSAPP_CHANNEL_SOUL_WEBHOOK_AUTH_TOKEN=supersecret
WHATSAPP_CHANNEL_SOUL_WEBHOOK_HEADERS_JSON={"x-flow":"mentor"}
```

## Configure Telegram

Example:

```env
TELEGRAM_CHANNEL_MODE=agent
TELEGRAM_CHANNEL_SOUL_PROVIDER=n8n
TELEGRAM_CHANNEL_SOUL_WEBHOOK_URL=https://your-n8n.example/webhook/valuya-bot-channel-runtime
TELEGRAM_CHANNEL_SOUL_WEBHOOK_AUTH_TOKEN=supersecret
TELEGRAM_CHANNEL_SOUL_WEBHOOK_HEADERS_JSON={"x-flow":"mentor"}
```

## Recommended first customizations

Inside the `Build Structured Reply` code node, replace the reference logic with:

- a call to OpenAI through `n8n`
- a LangChain service call
- CRM lookups
- ticket/user context lookups
- calendar or workflow tools

The important part is that the final response still returns either:

- plain text
- structured JSON matching the schema
- or a full `reply`/`memory` object

## Suggested production improvements

For a real deployment, extend the flow with:

- webhook authentication verification
- OpenAI or LangChain call node
- rate limiting
- error branch with friendly fallback
- event logging
- optional durable memory or CRM sync

## Node version note

`n8n` node versions can differ a bit between installations. If import complains, the flow is still the correct reference shape:

- keep the webhook path
- keep the response-node pattern
- keep the final JSON response contract

Usually only the node `typeVersion` values need minor adjustment.
