# Choose a Bot Channel Runtime Backend

This guide is the operator-facing entry point for choosing how agent-mode gated channels generate replies.

Use it when setting up:

- `@valuya/whatsapp-bot-channel`
- `@valuya/telegram-bot-channel`

The channel packages always keep responsibility for:

- Guard access resolution
- payment gating
- transport behavior
- local conversation memory persistence
- human vs agent routing

You choose only how the agent reply is produced.

## Quick choice

### Use OpenAI directly if:

- you want the fastest setup
- you do not need external orchestration yet
- you are comfortable keeping the runtime inside the channel package

Use:

```env
WHATSAPP_CHANNEL_SOUL_PROVIDER=openai
OPENAI_API_KEY=...
OPENAI_MODEL=gpt-5.2-chat-latest
```

### Use `n8n` if:

- you want no-code or low-code orchestration
- you want to call APIs, CRMs, or workflows visually
- you want the fastest external runtime without writing much code

Use:

```env
WHATSAPP_CHANNEL_SOUL_PROVIDER=n8n
WHATSAPP_CHANNEL_SOUL_WEBHOOK_URL=https://your-n8n.example/webhook/valuya-bot-channel-runtime
WHATSAPP_CHANNEL_SOUL_WEBHOOK_AUTH_TOKEN=supersecret
```

Guide:

- [n8n-bot-channel-runtime-guide.md](/home/colt/Software/valuya-guard/docs/n8n-bot-channel-runtime-guide.md)

### Use LangChain if:

- you want retrieval, tools, or graph-based orchestration
- you want to keep agent reasoning in a dedicated runtime service
- you want a cleaner path to more advanced agent behavior

Use:

```env
WHATSAPP_CHANNEL_SOUL_PROVIDER=langchain
WHATSAPP_CHANNEL_SOUL_WEBHOOK_URL=http://localhost:8800/runtime
WHATSAPP_CHANNEL_SOUL_WEBHOOK_AUTH_TOKEN=demo_secret
```

Guide:

- [langchain-bot-channel-runtime-guide.md](/home/colt/Software/valuya-guard/docs/langchain-bot-channel-runtime-guide.md)

### Use Python if:

- your team is Python-first
- you want FastAPI, Flask, LangChain Python, or internal ML services
- you want the same webhook contract without Node runtime code

Use:

```env
WHATSAPP_CHANNEL_SOUL_PROVIDER=api
WHATSAPP_CHANNEL_SOUL_WEBHOOK_URL=http://localhost:8801/runtime
WHATSAPP_CHANNEL_SOUL_WEBHOOK_AUTH_TOKEN=demo_secret
```

Guide:

- [python-bot-channel-runtime-guide.md](/home/colt/Software/valuya-guard/docs/python-bot-channel-runtime-guide.md)

## Decision matrix

| Backend | Best when | Setup speed | Flexibility | Code required |
|---|---|---:|---:|---:|
| OpenAI direct | fastest launch | high | medium | low |
| `n8n` | workflow-heavy teams | high | high | low |
| LangChain runtime | advanced agent logic | medium | very high | medium |
| Python runtime | Python-first teams | medium | high | medium |

## Runtime commands

Local Node demo runtime:

```bash
pnpm gated-channel:runtime-demo
```

LangChain-style Node runtime:

```bash
pnpm gated-channel:runtime-langchain
```

Python reference runtime:

```bash
python3 scripts/python_soul_runtime_reference.py
```

Validate a channel env before launch:

```bash
pnpm gated-channel:doctor --env packages/whatsapp-bot-channel/.env --channel whatsapp
pnpm gated-channel:doctor --channel telegram --preset mentor --slug mentor_demo
```

Validate all shipped presets and examples:

```bash
pnpm validate:gated-channels
```

## Shared contract

All external runtime options use the same contract:

- [external-soul-runtime-webhook-contract.md](/home/colt/Software/valuya-guard/docs/external-soul-runtime-webhook-contract.md)

That means you can switch from:

- OpenAI direct
- to `n8n`
- to LangChain
- to Python

without changing the channel package architecture.

## WhatsApp env template

```env
WHATSAPP_CHANNEL_MODE=agent
WHATSAPP_CHANNEL_SOUL_ID=mentor
WHATSAPP_CHANNEL_SOUL_NAME=Mentor
WHATSAPP_CHANNEL_SOUL_SYSTEM_PROMPT=Du bist ein ruhiger, klarer Mentor.
WHATSAPP_CHANNEL_SOUL_RESPONSE_SCHEMA_JSON={"format":"json","replyKey":"mentor_reply","followUpQuestionKey":"deep_question","nextStepKey":"next_step","summaryKey":"conversation_summary","userProfileKey":"user_profile","rootPatternKey":"root_pattern"}
```

Then choose one backend:

```env
WHATSAPP_CHANNEL_SOUL_PROVIDER=openai
OPENAI_API_KEY=...
OPENAI_MODEL=gpt-5.2-chat-latest
```

or:

```env
WHATSAPP_CHANNEL_SOUL_PROVIDER=n8n
WHATSAPP_CHANNEL_SOUL_WEBHOOK_URL=https://your-n8n.example/webhook/valuya-bot-channel-runtime
WHATSAPP_CHANNEL_SOUL_WEBHOOK_AUTH_TOKEN=supersecret
WHATSAPP_CHANNEL_SOUL_WEBHOOK_HEADERS_JSON={"x-flow":"mentor"}
```

## Telegram env template

```env
TELEGRAM_CHANNEL_MODE=agent
TELEGRAM_CHANNEL_SOUL_ID=mentor
TELEGRAM_CHANNEL_SOUL_NAME=Mentor
TELEGRAM_CHANNEL_SOUL_SYSTEM_PROMPT=Du bist ein ruhiger, klarer Mentor.
TELEGRAM_CHANNEL_SOUL_RESPONSE_SCHEMA_JSON={"format":"json","replyKey":"mentor_reply","followUpQuestionKey":"deep_question","nextStepKey":"next_step","summaryKey":"conversation_summary","userProfileKey":"user_profile","rootPatternKey":"root_pattern"}
```

Then choose one backend:

```env
TELEGRAM_CHANNEL_SOUL_PROVIDER=openai
OPENAI_API_KEY=...
OPENAI_MODEL=gpt-5.2-chat-latest
```

or:

```env
TELEGRAM_CHANNEL_SOUL_PROVIDER=langchain
TELEGRAM_CHANNEL_SOUL_WEBHOOK_URL=http://localhost:8800/runtime
TELEGRAM_CHANNEL_SOUL_WEBHOOK_AUTH_TOKEN=demo_secret
```

## Recommendation

Default recommendation:

- start with OpenAI direct if you need speed
- choose `n8n` if business workflows dominate
- choose LangChain if agent capability is the differentiator
- choose Python if team velocity is clearly strongest there
