# LangChain Bot Channel Runtime Guide

This guide is for teams that want to keep:

- Valuya Guard for gating and payment authority
- WhatsApp / Telegram packages for transport and memory
- LangChain or LangGraph for the actual agent reasoning

## Reference server

Runnable reference:

- [langchain-runtime-reference.ts](/home/colt/Software/valuya-guard/scripts/langchain-runtime-reference.ts)

Start it with:

```bash
pnpm gated-channel:runtime-langchain
```

Optional auth:

```bash
LANGCHAIN_RUNTIME_TOKEN=demo_secret pnpm gated-channel:runtime-langchain
```

It listens on:

- `POST http://localhost:8800/runtime`

## What it demonstrates

The reference server:

1. accepts the external soul runtime contract
2. reads:
   - `soul.systemPrompt`
   - `soul.responseSchema`
   - `memory.summaries`
   - `message`
3. builds a single prompt input
4. passes that into one function:
   - `runReferenceChain(...)`
5. returns a structured JSON response matching the channel schema

That function is the exact seam where a real LangChain pipeline should go.

## Where to plug LangChain in

Inside:

- [langchain-runtime-reference.ts](/home/colt/Software/valuya-guard/scripts/langchain-runtime-reference.ts)

replace:

- `runReferenceChain(...)`

with your real chain, graph, or tool-calling agent.

Typical swap-in:

- prompt template from `soul.systemPrompt`
- memory context from:
  - `memory.summaries`
  - `memory.recentTurns`
- retrieval/tool calls as needed
- final structured output using `soul.responseSchema`

## Configure WhatsApp

```env
WHATSAPP_CHANNEL_MODE=agent
WHATSAPP_CHANNEL_SOUL_PROVIDER=langchain
WHATSAPP_CHANNEL_SOUL_WEBHOOK_URL=http://localhost:8800/runtime
WHATSAPP_CHANNEL_SOUL_WEBHOOK_AUTH_TOKEN=demo_secret
```

## Configure Telegram

```env
TELEGRAM_CHANNEL_MODE=agent
TELEGRAM_CHANNEL_SOUL_PROVIDER=langchain
TELEGRAM_CHANNEL_SOUL_WEBHOOK_URL=http://localhost:8800/runtime
TELEGRAM_CHANNEL_SOUL_WEBHOOK_AUTH_TOKEN=demo_secret
```

## Recommended production structure

For a real LangChain deployment, keep this split:

- channel package:
  - access
  - transport
  - local short-term memory persistence
- LangChain runtime:
  - retrieval
  - tool orchestration
  - domain logic
  - optional long-term memory sync

## Output contract

The runtime should still return one of:

- plain text
- structured JSON matching the configured schema
- full `reply` / `memory` object

The canonical contract remains:

- [external-soul-runtime-webhook-contract.md](/home/colt/Software/valuya-guard/docs/external-soul-runtime-webhook-contract.md)
