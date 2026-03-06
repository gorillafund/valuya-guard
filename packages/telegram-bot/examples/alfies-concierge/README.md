# Alfies Concierge (Agent-based Payment)

Telegram bot example where payment/entitlement is handled by `@valuya/agent`.

- Payment path uses Valuya Agent APIs from the bot.
- n8n is only concierge logic (recipe/mock cart/confirm-alt-cancel text).
- Env naming follows `@valuya/cli` conventions (`VALUYA_BASE`, `VALUYA_TENANT_TOKEN`).

## Flow

1. User sends `/start`.
2. Bot shows whoami identity and asks for consent via inline button.
3. User sends recipe prompt.
4. Bot calls n8n `/webhook/alfies/concierge` with `action:"recipe"`.
5. On `confirm:<orderId>` callback, bot checks entitlement using agent-configured subject.
6. If inactive, bot creates checkout session via `@valuya/agent` and sends `Top up / Pay` URL.
7. User runs `/status` after payment.
8. When entitlement is active, confirm is forwarded to n8n.
9. Bot posts confirmed order details to `POST /api/agent/orders` for backend email dispatch.

## Required env vars

- `TELEGRAM_BOT_TOKEN`
- `N8N_BASE_URL`
- `N8N_WEBHOOK_PATH` (optional, default `/webhook/alfies/concierge`)
- `VALUYA_BASE`
- `VALUYA_TENANT_TOKEN`
- `VALUYA_BACKEND_BASE_URL` (Laravel backend base, receives `/api/agent/orders`)
- `VALUYA_BACKEND_TOKEN` (optional; fallback is `VALUYA_TENANT_TOKEN`)
- `VALUYA_PRIVATE_KEY` (agent wallet private key used to send payment tx)
- `VALUYA_RPC_URL` (RPC endpoint for the payment chain)
- `VALUYA_RESOURCE` (optional, defaults to Alfies bot resource)
- `VALUYA_PLAN` (optional, default `standard`, `free` is blocked)

Required tenant token scopes:
- `agent:products:read`
- `checkout:sessions:create`
- `agent:sessions:tx`
- `agent:sessions:verify`
- `usage`
- `agent:products:create` (required by `/api/agent/orders` route)

Example:

```bash
TELEGRAM_BOT_TOKEN=123456:abc
N8N_BASE_URL=https://valuya.app.n8n.cloud
N8N_WEBHOOK_PATH=/webhook/alfies/concierge
VALUYA_BASE=https://pay.gorilla.build
VALUYA_TENANT_TOKEN=ttok_...
VALUYA_BACKEND_BASE_URL=https://pay.gorilla.build
VALUYA_BACKEND_TOKEN=ttok_...
VALUYA_PRIVATE_KEY=0x...
VALUYA_RPC_URL=https://polygon-rpc.com
VALUYA_RESOURCE=telegram:bot:8748562521_aagildb2h9wfenj7uh5snityv-7zukwdj5o:recipe_confirm_alt_cancel_status
VALUYA_PLAN=standard
```

## Run locally

From repo root:

```bash
pnpm install
pnpm exec tsc -p packages/telegram-bot/examples/alfies-concierge/tsconfig.json
node packages/telegram-bot/examples/alfies-concierge/dist/telegram-bot/examples/alfies-concierge/bot.js
```

Or from this folder directly:

```bash
pnpm install
pnpm run build
pnpm run test
pnpm run start
```

## n8n workflow import

Use `workflow.alfies-concierge.n8n.json` in this folder.

- Import into n8n.
- Activate workflow.
- Ensure webhook path is `/webhook/alfies/concierge`.
- Keep n8n output plain text; bot applies MarkdownV2 escaping.

## Example conversation

1. `/start`
2. Bot shows identity and consent button.
3. User taps `I consent`.
4. User: `I want a vegetarian pasta for 2`.
5. Bot returns recipe/cart with buttons.
6. User taps `✅ Confirm`.
7. If payment required, bot sends `Top up / Pay` button with whoami identity details.
8. User pays and runs `/status`.
9. User taps `✅ Confirm` again -> bot forwards to n8n confirm and returns ETA.
10. Bot checks entitlement again, then submits order to `/api/agent/orders` with `resource`, `plan` and `X-Valuya-Subject`.
