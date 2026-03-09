# @valuya/whatsapp-bot

WhatsApp bot for the Alfies concierge flow using Twilio inbound webhooks, an in-process JS concierge, `@valuya/agent` payment flow, and Valuya backend order dispatch.

## Features

- Receives inbound WhatsApp messages via `POST /twilio/whatsapp/webhook`
- Runs concierge logic in-process (`recipe`, `alt`, `confirm`, `cancel`)
- Uses keyword replies (no inline buttons): `order`, `alt`, `cancel`, `status`
- Supports secure Valuya account linking via `LINK gls_...` messages
- Shows managed-agent capacity on successful onboarding link and `status`:
  - wallet balance
  - spendable overall
  - spendable for this WhatsApp bot right now
- Runs Valuya whoami + delegated Guard payment flow on `order`
- After successful payment, posts confirmed orders to `/api/agent/orders` for backend email/CSV dispatch
- Responds using TwiML plain text

## Environment

Copy `.env.example` and configure all values.

Required for base flow:

- `TWILIO_AUTH_TOKEN`
- `VALUYA_GUARD_BASE_URL` (or `VALUYA_BASE`)
- `VALUYA_TENANT_TOKEN`
- `WHATSAPP_CHANNEL_APP_ID` (default `whatsapp_main`)
- `VALUYA_BACKEND_BASE_URL`
- `VALUYA_BACKEND_TOKEN`
- `VALUYA_ORDER_RESOURCE` (preferred payment/entitlement resource for marketplace + Guard autopay)
- `VALUYA_PAYMENT_ASSET` (optional, defaults to `EURe`)
- `VALUYA_PAYMENT_CURRENCY` (optional, defaults to `EUR`)
- `OPENAI_API_KEY` (optional; enables intent/slot extraction while keeping execution deterministic)
- `OPENAI_MODEL` (optional; defaults to `gpt-4.1-mini`)
- `ALFIES_TEST_API_ENABLED` (optional; when `true`, `address: ...` messages try to initialize a live Alfies test-shop session)
- `ALFIES_TEST_API_BASE_URL` (optional; defaults to `https://test-api.alfies.shop/api/v1`)
- `ALFIES_TEST_DEFAULT_LATITUDE` / `ALFIES_TEST_DEFAULT_LONGITUDE` (temporary coordinates used for test-shop session address setup)
- `ALFIES_TEST_SHIPPING_METHOD` (optional; defaults to `standard`)
- `ALFIES_TEST_PRODUCT_MAP_JSON` (optional; curated keyword -> Alfies product id mapping for live basket creation)

Canonical seeded Alfies WhatsApp marketplace resource:

`whatsapp:bot:meta:alfies_whatsapp_marketplace:491234567890`

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
- Optional: user sends `address: Kaiserstrasse 8/7a, 1070 Wien`
- Bot replies with recipe/cart text and instructions:
  - `order` = confirm and pay
  - `alt` = request alternatives
  - `cancel` = cancel active order
  - `status` = show current order status

## Endpoint

- `POST /twilio/whatsapp/webhook`

Twilio webhook payload is form-encoded. The bot validates `X-Twilio-Signature` when `TWILIO_VALIDATE_SIGNATURE=true`.

## Notes

- State persistence is SQLite based (`WHATSAPP_STATE_FILE`).
- The built-in concierge is intentionally deterministic and mock-like for now; Alfies API integration can replace this module without changing the Twilio/payment flow.
- `AlfiesClient` is available for test-shop integration against `https://test-api.alfies.shop/api/v1` for address, basket, shipping, checkout preview, and order status.
- When `ALFIES_TEST_API_ENABLED=true`, the bot will attempt to turn `address: ...` messages into a live Alfies session address and fetch shipping methods using configured default coordinates.
- When `ALFIES_TEST_API_ENABLED=true`, recipe requests first try the locally indexed Alfies catalog, then fall back to `ALFIES_TEST_PRODUCT_MAP_JSON`.
- Import a local Alfies product index with:

```bash
pnpm --filter @valuya/whatsapp-bot import:alfies-catalog ./path/to/alfies-products.json
```

- If your source export is messy, normalize it first:

```bash
pnpm --filter @valuya/whatsapp-bot normalize:alfies-catalog ./raw-products.json ./alfies-products.normalized.json
pnpm --filter @valuya/whatsapp-bot import:alfies-catalog ./alfies-products.normalized.json
```

- The catalog JSON should be an array with entries like:

```json
[
  {
    "product_id": 101,
    "title": "Bio Spaghetti",
    "slug": "bio-spaghetti",
    "price_cents": 299,
    "currency": "EUR",
    "keywords": ["pasta", "spaghetti"],
    "category": "pasta"
  }
]
```

- The normalizer accepts looser source fields too, for example `id`, `name`, `price`, `category_name`, `brand`, `tags`, and `available`.
- When the local index has no match, `ALFIES_TEST_PRODUCT_MAP_JSON` remains the fallback.
- OpenAI is used only for intent/slot extraction when configured. Basket/payment/checkout execution remains tool- and code-driven.

Example `ALFIES_TEST_PRODUCT_MAP_JSON`:

```json
[
  {
    "label": "Pasta Bundle",
    "match": ["pasta", "spaghetti"],
    "products": [
      { "id": 101, "quantity": 1 },
      { "id": 202, "quantity": 1 }
    ]
  },
  {
    "label": "Snack Night",
    "match": ["snacks", "movie night"],
    "products": [
      { "id": 303, "quantity": 2 }
    ]
  }
]
```
- Outbound helper exists (`sendProactiveWhatsApp`) and can be used for proactive notifications.
- Keep `VALUYA_ORDER_RESOURCE` separate from `WHATSAPP_PAID_CHANNEL_RESOURCE`. The first is the resource used for marketplace order creation, delegated payment, and entitlement polling. The second is only for paid WhatsApp-channel access.
- Do not use `alfies.order` for payment or entitlement polling. If entitlements returns `product_not_registered`, treat that as a wrong resource configuration issue.
- Payment correlation logs use `event: "payment_trace"` with `trace_kind: "payment_correlation"`. Grep by `local_order_id` to collect the full subject/resource/plan/order tuple for backend debugging.
