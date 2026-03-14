# Gated Channel Starter Template

This is the default shape for any new gated Valuya channel.

Use it when launching:

- a mentor or coach channel
- a paid expert Q&A channel
- a concierge or assistant channel
- a support channel that should be human- or agent-moderated

## Mental model

- `channel-access` packages own Guard access resolution
- `bot-channel` packages own channel UX and moderation mode
- backend owns payment truth, runtime authorization, and durable access state

## Default build blocks

- `@valuya/whatsapp-bot-channel`
- `@valuya/telegram-bot-channel`
- `@valuya/bot-channel-core`
- `@valuya/bot-channel-app-core`
- `@valuya/bot-channel-server-core`
- `@valuya/bot-channel-bootstrap-core`

## Required decisions

1. Choose transport:
   - WhatsApp
   - Telegram
2. Choose moderation mode:
   - `human`
   - `agent`
3. Choose soul:
   - mentor
   - concierge
   - support
   - custom
4. Choose response schema:
   - plain reply
   - reply + deep question
   - reply + next steps
   - custom task schema

## Default response schema for mentor-style channels

```json
{
  "format": "json",
  "replyKey": "mentor_reply",
  "followUpQuestionKey": "deep_question",
  "followUpQuestionsKey": "follow_up_questions",
  "nextStepKey": "next_step",
  "summaryKey": "conversation_summary",
  "userProfileKey": "user_profile",
  "rootPatternKey": "root_pattern"
}
```

## Minimal launch checklist

1. Register Guard resource + plan for the channel.
2. Configure backend runtime mode and payment gating.
3. Fill the package `.env.example` for WhatsApp or Telegram.
4. Decide whether the channel is `human` or `agent`.
5. If `agent`, define:
   - soul id
   - soul prompt
   - response schema
6. Start the package server and test:
   - link flow
   - blocked unpaid user
   - paid user
   - human handoff or agent reply
7. Run the doctor before launch:
   - `pnpm gated-channel:doctor --env <path-to-env> --channel whatsapp|telegram`

## Fastest way to generate a config

Use the generator:

```bash
pnpm gated-channel:new --channel whatsapp --preset mentor --slug mentor_demo
pnpm gated-channel:new --channel telegram --preset concierge --slug vip_concierge
```

Optional flags:

- `--output <path>`
- `--name <display name>`
- `--app-id <channel app id>`
- `--phone-number <whatsapp number>`
- `--bot-name <telegram bot name>`
- `--invite-url <telegram invite url>`

## Channel patterns

### Mentor / coach

- best mode: `agent`
- needs:
  - reflective prompt
  - memory summaries
  - follow-up question schema

### Paid expert chat

- best mode: `human`
- needs:
  - simple gated access
  - clear human handoff reply

### Hybrid support

- best mode: backend-configured `human` or `agent`
- later useful:
  - explicit runtime fallback
  - routing metadata

## Recommended next file to copy from

- WhatsApp:
  - [`.env.example`](/home/colt/Software/valuya-guard/packages/whatsapp-bot-channel/.env.example)
- Telegram:
  - [`.env.example`](/home/colt/Software/valuya-guard/packages/telegram-bot-channel/.env.example)

## Runtime backend overview

If the channel runs in `agent` mode and you need to choose between:

- built-in OpenAI
- `n8n`
- LangChain
- Python/API runtime

start here:

- [choose-bot-channel-runtime-backend.md](/home/colt/Software/valuya-guard/docs/choose-bot-channel-runtime-backend.md)
