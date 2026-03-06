# @valuya/telegram-bot

Telegram bot app that forwards user actions to an n8n webhook implementing Valuya Guard payment gating.

## What this bot does

- Sends normal text messages to n8n as `action: "recipe"`
- Calls `GET /api/v2/agent/whoami` to expose current agent identity to the user
- Requires explicit user consent via inline button before running paid actions
- Handles payment gating from n8n (`HTTP 402 payment_required`)
- Handles inline callback actions:
  - `confirm:<orderId>`
  - `alt:<orderId>`
  - `cancel:<orderId>`
- Implements `/status` to re-check entitlement
- Retries n8n calls (up to 3 attempts, exponential backoff)
- Logs `requestId` and `orderId` for traceability

## n8n webhook contract

Endpoint used by this bot:

- `POST {N8N_WEBHOOK_URL}` if set
- otherwise `POST {N8N_BASE_URL}/webhook/valuya/agent/run`

Expected responses:

- `402` with payload:

```json
{
  "error": "payment_required",
  "payment_url": "https://...",
  "session_id": "...",
  "expires_at": "...",
  "orderId": "..."
}
```

- `200` with payload:

```json
{
  "ok": true,
  "orderId": "...",
  "telegram": {
    "text": "...",
    "keyboard": [[{ "text": "Confirm", "callback_data": "confirm:ord_123" }]]
  },
  "recipe": {},
  "cart": {}
}
```

## Message payload sent to n8n

For normal user text:

```json
{
  "resource": "telegram:bot:alfies:order",
  "plan": "standard",
  "subject": { "type": "telegram", "id": "<telegramUserId>" },
  "action": "recipe",
  "message": "<text>",
  "orderId": "<generated UUID if missing>"
}
```

For callbacks:

- `confirm:<orderId>` -> `action: "confirm"`
- `alt:<orderId>` -> `action: "alt"`
- `cancel:<orderId>` -> `action: "cancel"`

For `/status`:

- Uses `action: "status"`
- If not implemented by backend, bot falls back to `action: "confirm", dryRun: true`

For `/start` and `/whoami`:

- `/start` shows identity + consent button
- `/whoami` shows current agent identity from Valuya

## Configuration

Set env vars:

- `TELEGRAM_BOT_TOKEN`
- `N8N_WEBHOOK_URL` (recommended, full webhook URL)
- or `N8N_BASE_URL` (bot appends `/webhook/valuya/agent/run`)
- `VALUYA_TENANT_TOKEN` (required for `whoami` identity lookup)
- `VALUYA_BASE_URL` (optional, defaults to `https://pay.gorilla.build`)

See `.env.example`.

## Install and run

From repo root:

```bash
pnpm --filter @valuya/telegram-bot build
TELEGRAM_BOT_TOKEN=... N8N_WEBHOOK_URL=https://n8n.example.com/webhook/valuya/agent/run-alfi pnpm --filter @valuya/telegram-bot exec node dist/app.js
```

## Example conversation

1. User: `give me a pasta recipe`
2. Bot: shows `whoami` identity and asks for consent button tap
3. User taps `✅ I consent to agent payments`
4. User: `give me a pasta recipe`
5. Bot (402 path): `Payment is required before I can continue...` + `Pay now` button
6. User pays via link
7. User: `/status`
8. Bot: `Payment confirmed` style response from n8n (or payment prompt again if still gated)
9. Bot (200 path): sends `telegram.text` and inline keyboard from `telegram.keyboard`

## Source file

Bot entrypoint: `src/app.ts`
