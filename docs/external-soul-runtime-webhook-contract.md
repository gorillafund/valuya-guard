# External Soul Runtime Webhook Contract

This contract makes gated bot channels work with external AI runtimes such as:

- `n8n`
- LangChain services
- custom Python/Node agent APIs
- internal orchestration backends

The channel package remains responsible for:

- Guard access resolution
- human vs agent routing
- conversation memory persistence
- WhatsApp / Telegram transport behavior

The external runtime is responsible for:

- producing the next reply
- optionally returning structured payload fields
- optionally returning a fully updated memory object

## Fastest local demo

There is a runnable reference server in:

- [external-soul-runtime-demo.ts](/home/colt/Software/valuya-guard/scripts/external-soul-runtime-demo.ts)

Start it with:

```bash
pnpm gated-channel:runtime-demo
```

Optional auth:

```bash
SOUL_RUNTIME_DEMO_TOKEN=demo_secret pnpm gated-channel:runtime-demo
```

It listens on:

- `POST http://localhost:8799/runtime`

and returns a schema-aware structured reply that works with the WhatsApp and Telegram channel packages out of the box.

## Configure the provider

WhatsApp:

- `WHATSAPP_CHANNEL_SOUL_PROVIDER=webhook`
- aliases also accepted:
  - `n8n`
  - `langchain`
  - `api`
- `WHATSAPP_CHANNEL_SOUL_WEBHOOK_URL=https://...`
- optional:
  - `WHATSAPP_CHANNEL_SOUL_WEBHOOK_AUTH_TOKEN=...`
  - `WHATSAPP_CHANNEL_SOUL_WEBHOOK_TIMEOUT_MS=30000`
  - `WHATSAPP_CHANNEL_SOUL_WEBHOOK_HEADERS_JSON={"x-flow":"mentor"}`

Telegram:

- `TELEGRAM_CHANNEL_SOUL_PROVIDER=webhook`
- aliases also accepted:
  - `n8n`
  - `langchain`
  - `api`
- `TELEGRAM_CHANNEL_SOUL_WEBHOOK_URL=https://...`
- optional:
  - `TELEGRAM_CHANNEL_SOUL_WEBHOOK_AUTH_TOKEN=...`
  - `TELEGRAM_CHANNEL_SOUL_WEBHOOK_TIMEOUT_MS=30000`
  - `TELEGRAM_CHANNEL_SOUL_WEBHOOK_HEADERS_JSON={"x-flow":"mentor"}`

## Request

The channel sends `POST <webhook_url>` with `Content-Type: application/json`.

If `*_SOUL_WEBHOOK_AUTH_TOKEN` is configured, the request also includes:

- `Authorization: Bearer <token>`

If `*_SOUL_WEBHOOK_HEADERS_JSON` is configured, those headers are merged in too.

Request body:

```json
{
  "version": "1",
  "provider": "webhook",
  "soul": {
    "id": "mentor",
    "name": "Mentor",
    "locale": "de",
    "systemPrompt": "Du bist ein ruhiger, klarer Mentor ...",
    "tools": [],
    "memoryPolicy": {
      "keepRecentTurns": 12,
      "summarizeAfterTurns": 8
    },
    "responseSchema": {
      "format": "json",
      "replyKey": "mentor_reply",
      "followUpQuestionKey": "deep_question",
      "nextStepKey": "next_step",
      "summaryKey": "conversation_summary",
      "userProfileKey": "user_profile",
      "rootPatternKey": "root_pattern"
    }
  },
  "message": "Ich stehe gerade sehr unter Druck.",
  "memory": {
    "recentTurns": [],
    "summaries": [],
    "userProfile": {},
    "updatedAt": "2026-03-14T09:00:00.000Z"
  },
  "protocolSubjectHeader": "user:17",
  "locale": "de",
  "context": {
    "protocolSubjectHeader": "user:17",
    "locale": "de"
  }
}
```

Notes:

- `provider` is normalized by the channel package.
- if you configured `n8n` or `langchain`, the request still arrives with:
  - `"provider": "webhook"`
- the external service should treat `soul.id` as the canonical machine identifier

## Response options

The webhook may return one of these shapes.

### 1. Plain text

```json
"Das klingt gerade sehr eng fuer dich. Was macht dir daran am meisten Druck?"
```

### 2. Structured schema payload

```json
{
  "mentor_reply": "Das klingt gerade sehr eng fuer dich.",
  "deep_question": "Was macht dir daran am meisten Druck?",
  "next_step": "Beschreibe den einen Teil, der sich heute am schwersten anfuehlt.",
  "conversation_summary": "Der Nutzer berichtet von starkem Druck.",
  "user_profile": {
    "focus_area": "stress"
  }
}
```

### 3. Full SoulResponse-style object

```json
{
  "reply": "Das klingt gerade sehr eng fuer dich. Was macht dir daran am meisten Druck?",
  "memory": {
    "recentTurns": [],
    "summaries": ["Der Nutzer berichtet von starkem Druck."],
    "userProfile": {
      "focus_area": "stress"
    },
    "updatedAt": "2026-03-14T09:00:05.000Z"
  },
  "metadata": {
    "flow": "mentor-v1"
  }
}
```

## Memory behavior

If the webhook returns:

- `memory`

the package uses that memory as-is.

If the webhook does not return `memory`, the package:

- appends the user message
- appends the assistant reply
- merges schema-derived summary/profile fields automatically

That keeps n8n/LangChain integrations simple: returning just the reply is enough for a working channel.

## Error behavior

If the webhook returns a non-2xx response, the runtime fails with:

- `bot_channel_webhook_runtime_failed:<status>:...`

The channel package then uses its normal error handling path.

## Recommended use by provider

`n8n`

- use a webhook trigger
- inspect `message`, `memory`, and `soul.responseSchema`
- return structured JSON matching the schema keys
- the demo server above is a good reference for the response shape
- ready-to-import reference flow:
  - [n8n-valuya-bot-channel-runtime.json](/home/colt/Software/valuya-guard/docs/examples/n8n-valuya-bot-channel-runtime.json)
- setup guide:
  - [n8n-bot-channel-runtime-guide.md](/home/colt/Software/valuya-guard/docs/n8n-bot-channel-runtime-guide.md)

LangChain or custom agent API

- use `soul.systemPrompt` as the base persona
- use `memory.recentTurns` and `memory.summaries` as retrieval/context input
- return either plain text or a structured JSON object
- runnable reference:
  - [langchain-runtime-reference.ts](/home/colt/Software/valuya-guard/scripts/langchain-runtime-reference.ts)
- setup guide:
  - [langchain-bot-channel-runtime-guide.md](/home/colt/Software/valuya-guard/docs/langchain-bot-channel-runtime-guide.md)

Python

- runnable reference:
  - [python_soul_runtime_reference.py](/home/colt/Software/valuya-guard/scripts/python_soul_runtime_reference.py)
- setup guide:
  - [python-bot-channel-runtime-guide.md](/home/colt/Software/valuya-guard/docs/python-bot-channel-runtime-guide.md)
