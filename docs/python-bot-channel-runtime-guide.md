# Python Bot Channel Runtime Guide

This is the simplest Python entry point for powering a gated WhatsApp or Telegram channel with an external runtime.

It is a good fit when your team wants:

- Python-first agent code
- a FastAPI or Flask migration path later
- the same contract as the Node and `n8n` examples

## Reference server

Runnable stdlib reference:

- [python_soul_runtime_reference.py](/home/colt/Software/valuya-guard/scripts/python_soul_runtime_reference.py)

Run it with:

```bash
python3 scripts/python_soul_runtime_reference.py
```

Optional auth:

```bash
PYTHON_RUNTIME_TOKEN=demo_secret python3 scripts/python_soul_runtime_reference.py
```

It listens on:

- `POST http://localhost:8801/runtime`

## What it demonstrates

The reference server:

1. accepts the external soul runtime webhook contract
2. reads:
   - `message`
   - `memory`
   - `soul`
   - `soul.responseSchema`
3. detects a simple root pattern
4. returns structured JSON using the schema keys requested by the channel

That means it works for:

- mentor
- support
- concierge

without changing the package-side contract.

## Configure WhatsApp

```env
WHATSAPP_CHANNEL_MODE=agent
WHATSAPP_CHANNEL_SOUL_PROVIDER=api
WHATSAPP_CHANNEL_SOUL_WEBHOOK_URL=http://localhost:8801/runtime
WHATSAPP_CHANNEL_SOUL_WEBHOOK_AUTH_TOKEN=demo_secret
```

## Configure Telegram

```env
TELEGRAM_CHANNEL_MODE=agent
TELEGRAM_CHANNEL_SOUL_PROVIDER=api
TELEGRAM_CHANNEL_SOUL_WEBHOOK_URL=http://localhost:8801/runtime
TELEGRAM_CHANNEL_SOUL_WEBHOOK_AUTH_TOKEN=demo_secret
```

## How to evolve it

This reference intentionally uses only Python stdlib so it is easy to inspect.

Typical next step:

- keep the same request/response contract
- replace `HTTPServer` with FastAPI
- replace the heuristic reply builder with:
  - LangChain Python
  - OpenAI Python SDK
  - internal retrieval/tool orchestration

The contract does not change.

## Source of truth

The canonical request/response contract remains:

- [external-soul-runtime-webhook-contract.md](/home/colt/Software/valuya-guard/docs/external-soul-runtime-webhook-contract.md)
