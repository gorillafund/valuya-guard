# @valuya/whatsapp-bot

WhatsApp bot for the Alfies concierge flow using Twilio inbound webhooks, `@valuya/agent` payment flow, and Valuya backend order dispatch.

## Features

- Receives inbound WhatsApp messages via `POST /twilio/whatsapp/webhook`
- Calls the same n8n concierge endpoint used by Telegram (`recipe`, `alt`, `confirm`)
- Uses keyword replies (no inline buttons): `order`, `alt`, `cancel`, `status`
- Runs Valuya whoami + agent payment flow on `order`
- Posts confirmed orders to `/api/agent/orders` for backend email/CSV dispatch
- Responds using TwiML plain text

## Environment

Copy `.env.example` and configure all values.

Required for base flow:

- `TWILIO_AUTH_TOKEN`
- `N8N_CONCIERGE_URL`
- `VALUYA_GUARD_BASE_URL` (or `VALUYA_BASE`)
- `VALUYA_TENANT_TOKEN`
- `VALUYA_BACKEND_BASE_URL`
- `VALUYA_BACKEND_TOKEN`

Required for automatic on-chain payment execution:

- `VALUYA_PRIVATE_KEY`
- `VALUYA_RPC_URL`

## Twilio WhatsApp setup

1. Configure a WhatsApp sender in Twilio:
- For testing, use Twilio WhatsApp Sandbox.
- For production, use an approved WhatsApp sender number.

2. Set incoming webhook in Twilio Console:
- Method: `POST`
- URL: `https://<your-host>/twilio/whatsapp/webhook`

3. For local testing with ngrok:
- Run bot locally on `http://localhost:8788`
- Start tunnel: `ngrok http 8788`
- Use ngrok HTTPS URL for Twilio webhook
- If `TWILIO_VALIDATE_SIGNATURE=true`, set `TWILIO_WEBHOOK_PUBLIC_URL` to the exact public webhook URL

## Run

```bash
pnpm --filter @valuya/whatsapp-bot build
pnpm --filter @valuya/whatsapp-bot start
```

## Message UX

- User sends dish text, e.g. `Paella`
- Bot replies with recipe/cart text and instructions:
  - `order` = confirm and pay
  - `alt` = request alternatives
  - `cancel` = cancel active order
  - `status` = show current order status

## Endpoint

- `POST /twilio/whatsapp/webhook`

Twilio webhook payload is form-encoded. The bot validates `X-Twilio-Signature` when `TWILIO_VALIDATE_SIGNATURE=true`.

## Notes

- State persistence is JSON file based (`WHATSAPP_STATE_FILE`).
- TODO: migrate to SQLite for stronger multi-instance consistency.
- Outbound helper exists (`sendProactiveWhatsApp`) and can be used for proactive notifications.
