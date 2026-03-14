# Gated Channel Demo Presets

These presets are the fastest way to launch a convincing gated channel demo.

## Included presets

### `mentor`

Best for:
- coaching
- reflective guidance
- emotional clarity
- deeper follow-up conversations

Main tone:
- calm
- precise
- reflective

Schema keys:
- `mentor_reply`
- `deep_question`
- `follow_up_questions`
- `next_step`

### `support`

Best for:
- premium user support
- member helplines
- technical or service clarification

Main tone:
- reassuring
- concrete
- structured

Schema keys:
- `support_reply`
- `clarifying_question`
- `next_step`

### `concierge`

Best for:
- premium recommendations
- guided selection
- personal assistance
- high-touch customer communication

Main tone:
- attentive
- discreet
- solution-oriented

Schema keys:
- `concierge_reply`
- `clarifying_question`
- `option_questions`
- `recommended_next_step`

## Ready-made env files

WhatsApp:
- [mentor](/home/colt/Software/valuya-guard/packages/whatsapp-bot-channel/.env.mentor.example)
- [support](/home/colt/Software/valuya-guard/packages/whatsapp-bot-channel/.env.support.example)
- [concierge](/home/colt/Software/valuya-guard/packages/whatsapp-bot-channel/.env.concierge.example)

Telegram:
- [mentor](/home/colt/Software/valuya-guard/packages/telegram-bot-channel/.env.mentor.example)
- [support](/home/colt/Software/valuya-guard/packages/telegram-bot-channel/.env.support.example)
- [concierge](/home/colt/Software/valuya-guard/packages/telegram-bot-channel/.env.concierge.example)

## How to use them

1. Copy the preset that fits the demo best.
2. Fill in the real Guard values.
3. Fill in the real channel identifiers.
4. Keep the provided soul id, name, and schema unless you already know why to change them.
5. Adjust only the system prompt text to match your brand or domain.
6. If you want to use `n8n`, LangChain, or your own agent API instead of the built-in OpenAI runtime, switch the preset to:
   - `*_CHANNEL_SOUL_PROVIDER=webhook`
   - or aliases:
     - `n8n`
     - `langchain`
     - `api`
   - and set `*_CHANNEL_SOUL_WEBHOOK_URL`

## Generator shortcut

Instead of copying manually, generate a starter config:

```bash
pnpm gated-channel:new --channel whatsapp --preset support --slug support_demo
pnpm gated-channel:new --channel telegram --preset mentor --slug mentor_demo
```

For the external runtime request/response contract, see:
- [external-soul-runtime-webhook-contract.md](/home/colt/Software/valuya-guard/docs/external-soul-runtime-webhook-contract.md)
