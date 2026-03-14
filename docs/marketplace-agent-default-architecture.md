# Marketplace Agent Default Architecture

This is the default implementation model for any new marketplace agent across WhatsApp and Telegram.

## Principle

Do not build a separate commerce backend per channel.

Instead:

- merchant owns:
  - catalog data
  - fulfillment after payment
- Valuya owns:
  - subject resolution
  - access control
  - marketplace order creation
  - checkout and payment confirmation
  - paid-order delivery back to the merchant
- channel packages own:
  - transport UX
  - session state
  - conversation/runtime orchestration

## Shared package strategy

Use one channel-neutral core package:

- `@valuya/marketplace-agent-core`

Then keep channel shells thin:

- `@valuya/whatsapp-marketplace-agent`
- `@valuya/telegram-marketplace-agent`

The merchant integration must be reusable across both.

## Merchant contract for v1

Every merchant should only need to provide:

1. catalog endpoint
2. paid-order callback endpoint
3. auth token or signing secret

Everything else should stay in Valuya.

## Backend authority

The backend should remain authoritative for:

- merchant integration storage keyed by `tenant_id + merchant_slug`
- catalog fetching from the merchant
- normalized marketplace order creation
- checkout and payment state
- async paid-order webhook delivery
- retries and idempotent delivery records

Agent packages should not invent a second merchant callback system.

## Agent package responsibilities

The default marketplace agent should:

- surface merchant catalog items
- collect basket intent
- create marketplace orders through backend
- surface checkout links
- react to payment states like `status` and `confirm`
- show final paid confirmation state

The agent should not:

- price products itself
- decide whether an order is truly paid
- call merchant fulfillment inline after payment
- special-case WhatsApp and Telegram merchant integrations separately

## Catalog ingestion model

The channel runtime should ask Valuya backend for catalog access.

Recommended backend flow:

1. channel runtime asks backend for merchant catalog
2. backend calls merchant catalog endpoint using stored merchant credentials
3. backend normalizes merchant items
4. runtime uses normalized catalog results

Recommended normalized item fields:

- `merchant_product_id`
- `title`
- `description`
- `price_cents`
- `currency`
- `image_url`
- `category`
- `tags`
- `resource`
- `plan`
- `meta`

## Default runtime flow

1. user enters marketplace via WhatsApp or Telegram
2. runtime resolves access/linking
3. runtime browses or searches merchant catalog through backend
4. runtime collects basket lines
5. runtime creates marketplace order
6. runtime opens Valuya checkout
7. runtime checks `status`
8. runtime uses `confirm` only for paid-order handoff / post-payment progression
9. backend asynchronously delivers paid-order webhook to merchant

## Recommended implementation phases

### Phase 1

- create `@valuya/marketplace-agent-core`
- define shared contracts for:
  - catalog items
  - basket lines
  - marketplace order state
  - checkout/status/confirm rendering helpers
- keep WhatsApp and Telegram unchanged functionally

### Phase 2

- refactor `@valuya/whatsapp-bot-agent` to use `@valuya/marketplace-agent-core`
- extract channel-neutral payment/order helpers from current Alfies-specific flow
- preserve backend authority for paid state

### Phase 3

- refactor `packages/telegram-bot/examples/alfies-concierge` onto the same core
- remove duplicate paid-order status logic
- align final paid confirmation output across channels

### Phase 4

- add backend catalog-query adapter contract
- add merchant bootstrap documentation and validation tooling
- introduce channel-neutral merchant config by `merchant_slug`

### Phase 5

- publish thin channel packages:
  - `@valuya/whatsapp-marketplace-agent`
  - `@valuya/telegram-marketplace-agent`
- keep merchant integration config fully channel-neutral

## Immediate next migration targets

The best first shared pieces to move from current implementations are:

- marketplace order status rendering
- PolygonScan link rendering
- checkout prepared replies
- paid-but-not-yet-submitted vs submitted state handling
- normalized basket line types
- backend adapter contract for:
  - `queryCatalog`
  - `createMarketplaceOrder`
  - `createCheckoutLink`
  - `getMarketplaceOrder`

## Constraint reminders

- no channel-specific merchant fulfillment paths
- no agent-owned payment truth
- no merchant secrets in channel runtime packages
- no direct merchant fulfillment from WhatsApp or Telegram agents
