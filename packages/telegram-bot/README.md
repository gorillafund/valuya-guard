# @valuya/telegram-bot

Telegram Bot adapter for Valuya Guard v2 (Option A: one global resource for the whole bot).

## What it does

- Maps Telegram users to a stable Guard subject: `telegram:<telegramUserId>`
- Checks `/api/v2/entitlements`
- If inactive:
  - creates a checkout session
  - sends the on-chain payment via the agent wallet
  - submits tx proof
  - verifies and mints mandate
- Replies in Telegram with success/failure

## Setup

### 1) Env vars

Create `.env` (or export env vars):

- TELEGRAM_BOT_TOKEN=...
- VALUYA_BASE=https://pay.gorilla.build
- VALUYA*TENANT_TOKEN=tt*...
- VALUYA_RESOURCE=telegram:bot:<resourceId>
- VALUYA_PLAN=standard
- VALUYA_CURRENCY=EUR
- VALUYA_AMOUNT_CENTS=9900

Agent wallet (pays on behalf of users):

- VALUYA_PRIVATE_KEY=0x...
- VALUYA_FROM_ADDRESS=0x...

Optional:

- VALUYA_POLL_INTERVAL_MS=3000
- VALUYA_POLL_TIMEOUT_MS=90000

### 2) Backend requirements

- Product exists for (tenant_id + resource).
- Subject type `telegram` is accepted consistently by your subject resolver and mandate checks.

## Run (dev)

From repo root:

```bash
pnpm -r install
pnpm --filter @valuya/telegram-bot dev
```
