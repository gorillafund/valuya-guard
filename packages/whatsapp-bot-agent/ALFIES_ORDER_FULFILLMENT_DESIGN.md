# Alfies Paid Order Fulfillment Design

## Goal

Submit a real Alfies order only after Valuya payment is confirmed, while keeping the WhatsApp agent package cleanly split across:

- conversational planning
- cart and checkout tools
- Guard payment orchestration
- Alfies fulfillment handoff

This design is for the normal paid order flow, not the 1-cent test checkout.

## Key constraint from the Alfies sandbox API

Based on the Alfies sandbox Swagger at:

- `http://34.159.76.193/alfiesapidocu/`
- OpenAPI document: `alfies-openapi.yaml`

the storefront API exposes:

- basket endpoints
- session/shipping address endpoints
- shipping-method lookup
- checkout preview
- checkout submit
- order lookup

It does not expose a merchant-facing "mark this external order as paid" endpoint in the documented surface.

That means the safe integration model is:

1. prepare the Alfies order context
2. wait for Valuya payment success
3. only then submit the Alfies checkout/order

In other words, Alfies should learn about the order when we are ready to fulfill it, not earlier.

## What Alfies needs to know

To submit a real order, the integration must provide:

- what was bought
  - Alfies product ids and quantities
- where to deliver
  - shipping/session address
- which shipping slot/method to use
  - chosen shipping method object/code/date
- optional delivery notes / phone
- billing address if required by checkout

The relevant documented endpoints are:

- `POST /basket/products`
- `GET /basket/`
- `POST /accounts/addresses/session-address`
- `POST /basket/shipping-methods`
- `POST /checkout/preview`
- `POST /checkout/`
- `GET /accounts/orders/{id}`

## Current gap in `@valuya/whatsapp-bot-agent`

Today, `BackendAlfiesCheckoutAdapter` is still a placeholder dispatch adapter:

- it posts to our own backend `/api/agent/orders`
- it hardcodes:
  - customer number
  - delivery address
  - delivery type
- it does not carry real paid-order state
- it does not model:
  - Alfies session creation
  - address persistence
  - shipping-method selection
  - checkout preview
  - checkout submit

So the package currently supports "paid and then dispatch something to backend", but not a real Alfies storefront order lifecycle.

## Target architecture inside this package

We should split Alfies fulfillment into two layers:

1. WhatsApp agent orchestration layer
2. Alfies storefront/session adapter layer

The agent package should continue to own:

- conversation
- cart intent
- Guard payment state
- final "now submit order" decision

The Alfies adapter should own:

- session basket sync
- address creation / selection
- shipping-method lookup
- checkout preview
- checkout submit

## Recommended port evolution

Current port:

- `AlfiesCheckoutPort`
  - `priceCart(...)`
  - `dispatchOrder(...)`

Recommended target port:

```ts
export type AlfiesCheckoutPort = {
  priceCart(args: {
    lines: AlfiesCartLine[]
  }): Promise<{ amountCents: number; currency: string }>

  prepareCheckout(args: {
    localOrderId: string
    protocolSubjectHeader: string
    lines: AlfiesCartLine[]
    deliveryAddress: AlfiesDeliveryAddress
    shippingDate: string
    deliveryNote?: string
    phone?: string
  }): Promise<{
    basketId?: string
    basketTotalCents: number
    currency: string
    shippingAddressId?: number
    shippingAddress: AlfiesResolvedAddress
    shippingOptions: AlfiesShippingOption[]
    suggestedShippingOption?: AlfiesShippingOption
  }>

  submitPaidOrder(args: {
    localOrderId: string
    protocolSubjectHeader: string
    paymentReference: string
    lines: AlfiesCartLine[]
    deliveryAddress: AlfiesDeliveryAddress
    billingAddress?: AlfiesDeliveryAddress
    shippingOption: AlfiesShippingOption
    expectedTotalCents: number
  }): Promise<{
    ok: true
    externalOrderId: string
    externalOrderStatus?: string
    submittedAt: string
  }>
}
```

The old `dispatchOrder(...)` can remain temporarily as a compatibility shim that calls `submitPaidOrder(...)`.

## Required order state in conversation / backend

Before payment, we need a durable record of the pending Alfies checkout context.

Suggested persisted order state:

- `localOrderId`
- `whatsappUserId`
- `protocolSubjectHeader`
- `guardOrderId`
- `guardCheckoutUrl`
- `guardPaymentStatus`
- `cartLines`
- `alfiesProductIds`
- `deliveryAddress`
- `billingAddress`
- `shippingDate`
- `shippingOptions`
- `selectedShippingOption`
- `alfiesBasketSnapshot`
- `alfiesPreviewTotalCents`
- `currency`
- `submittedToAlfiesAt`
- `alfiesOrderId`

This state should live in the backend system of record, not only in WhatsApp conversation metadata.

Conversation metadata can keep a lightweight pointer:

- `currentOrderId`
- `pendingCheckoutState`
- `selectedShippingOptionCode`
- `deliveryAddressSummary`

## End-to-end flow

### 1. Cart becomes checkout-ready

The shopper has:

- chosen items
- given delivery address
- optionally chosen a time slot

If address or shipping slot is missing, the agent must ask for them before payment.

### 2. Prepare Alfies checkout context

Tool call sequence:

1. `cart.get_active`
2. `alfies.prepare_checkout`

`alfies.prepare_checkout` should:

- create/reset the Alfies basket/session
- add all basket lines via `POST /basket/products`
- set session address via `POST /accounts/addresses/session-address`
- query shipping options via `POST /basket/shipping-methods`
- optionally run `POST /checkout/preview`

It returns:

- confirmed Alfies pricing
- shipping options
- selected default/suggested shipping option
- shipping address id/details

### 3. Create Valuya order from the prepared Alfies snapshot

Tool calls:

1. `valuya.create_marketplace_order`
2. `valuya.create_checkout_link`

The amount used for Guard payment should come from the prepared Alfies pricing snapshot, not from a loosely summed cart.

### 4. Shopper pays

The shopper pays through Valuya hosted checkout or delegated payment.

The source of truth for payment success is Guard / Valuya backend state.

### 5. Payment confirmation triggers Alfies submit

This should happen from backend-confirmed payment state, not purely from a chat message.

Recommended trigger:

- Valuya payment success webhook
- or backend-verified payment success polling

Then call:

- `alfies.submit_paid_order`

This step should:

- rebuild or validate the current Alfies basket/session
- confirm expected totals still match
- submit `POST /checkout/`
- capture Alfies order id

### 6. Notify shopper

After successful submit:

- store `alfiesOrderId`
- update marketplace/backend order status to `submitted_to_alfies`
- send WhatsApp confirmation:
  - order placed
  - delivery slot
  - Alfies order reference if available

## Suggested tool contract changes

Add:

- `alfies.prepare_checkout`
- `alfies.submit_paid_order`

Retain:

- `alfies.price_cart`

Deprecate over time:

- `alfies.dispatch_order`

### `alfies.prepare_checkout`

Input:

```json
{
  "localOrderId": "wa-agent-123",
  "lines": [],
  "deliveryAddress": {},
  "shippingDate": "2026-03-14",
  "phone": "+43123456789",
  "deliveryNote": "3. Stock, bitte anrufen"
}
```

Output:

```json
{
  "ok": true,
  "basketTotalCents": 3480,
  "currency": "EUR",
  "shippingAddressId": 991,
  "shippingOptions": [],
  "suggestedShippingOption": {},
  "preview": {}
}
```

### `alfies.submit_paid_order`

Input:

```json
{
  "localOrderId": "wa-agent-123",
  "paymentReference": "guard_pay_123",
  "lines": [],
  "deliveryAddress": {},
  "shippingOption": {},
  "expectedTotalCents": 3480
}
```

Output:

```json
{
  "ok": true,
  "externalOrderId": "alfies_987654",
  "externalOrderStatus": "submitted",
  "submittedAt": "2026-03-14T10:15:00Z"
}
```

## Runtime behavior changes

`SimpleCheckoutAgentRuntime` should evolve from:

- `checkout` -> create Guard order -> checkout link
- `confirm` -> dispatch order if entitlement active

to:

- `checkout`
  - ensure delivery address exists
  - ensure shipping option exists
  - call `alfies.prepare_checkout`
  - create Guard order from Alfies-confirmed amount
  - create checkout link

- `status`
  - report Guard payment state
  - if paid but not yet submitted, tell user order is being sent to Alfies
  - if submitted, return Alfies order reference

- `confirm`
  - should no longer be the primary submit trigger for paid orders
  - may remain as a manual fallback only if backend payment confirmation already happened

## Backend responsibility split

The WhatsApp package should not become the final source of truth for paid fulfillment.

Recommended split:

- WhatsApp agent package
  - creates checkout intent
  - collects missing delivery details
  - explains status to the shopper

- backend order service
  - stores order state
  - stores delivery address and shipping selection
  - listens for payment success
  - submits Alfies order
  - records Alfies order id and status

This is especially important for:

- webhook retries
- idempotency
- price drift
- order recovery after process restarts

## Idempotency requirements

Every state-changing external step needs an idempotency key.

Suggested keys:

- Alfies basket sync:
  - `alfies:basket-sync:{localOrderId}:v1`
- Alfies prepare checkout:
  - `alfies:prepare:{localOrderId}:v1`
- Guard marketplace order:
  - existing local order id based key
- Alfies submit after payment:
  - `alfies:submit:{localOrderId}:{paymentReference}`

## Data mapping needed before real implementation

The current cart lines are:

- `sku`
- `name`
- `qty`
- `unitPriceCents`

For real Alfies storefront order submission we also need:

- Alfies product id
- price as seen by Alfies at preparation time

So cart state should evolve to preserve:

- `productId`
- `sku`
- `name`
- `qty`
- `unitPriceCents`

Without product id retention, the backend would need to re-resolve every SKU/name at submit time, which is fragile.

## Practical implementation order

1. extend cart line model to retain Alfies `productId`
2. extend `AlfiesCheckoutPort` with `prepareCheckout(...)` and `submitPaidOrder(...)`
3. replace hardcoded address/customer placeholders in `BackendAlfiesCheckoutAdapter`
4. add backend persistence for:
   - delivery address
   - shipping option
   - prepared Alfies snapshot
5. make runtime `checkout` call `alfies.prepare_checkout` before Guard order creation
6. move actual Alfies submit behind backend-confirmed payment success
7. downgrade `confirm` from primary trigger to fallback/status helper

## Minimal first production-safe version

If we want the smallest safe version first:

- keep WhatsApp chat collecting:
  - basket
  - delivery address
  - slot
- `checkout` calls backend `prepare`
- backend:
  - syncs Alfies basket
  - computes final amount
  - stores prepared checkout snapshot
- Guard checkout starts
- backend payment webhook calls backend `submit`
- WhatsApp only shows status updates

That is the safest path with the least risk of paid-but-unsubmitted orders.
