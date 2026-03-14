# Alfies App Integration

This guide is for a developer integrating Valuya Guard into a separate app that lets users buy Alfies groceries.

The recommended model is:

1. Your app owns the shopping UX and cart building.
2. Valuya Guard owns payment authorization and entitlement checks.
3. Your backend creates a Valuya marketplace order for the Alfies basket.
4. Your backend either:
   - charges via delegated payment, or
   - falls back to a hosted checkout link
5. After payment is active, your backend submits the order to Alfies or to your internal Alfies-order service.

## When to use this flow

Use this flow when:

- your app has its own UI, not one of the built-in bot adapters
- you want to charge through Valuya Guard
- the purchase is an Alfies grocery order
- you need a deterministic, auditable payment record before dispatching the order

## Recommended architecture

Split responsibilities this way:

- Frontend/app:
  - sign user in
  - build or edit Alfies cart
  - show payment required / payment confirmed states
- Your backend:
  - maps your user to a Valuya subject
  - calculates total amount and canonical cart payload
  - creates marketplace orders in Valuya
  - attempts delegated payment when possible
  - falls back to checkout link when needed
  - dispatches the confirmed Alfies order
- Valuya Guard:
  - evaluates entitlements
  - creates checkout sessions / checkout links
  - stores marketplace order/payment state
  - verifies delegated or hosted payment

## Core concepts

`subject`
: the buyer identity used by Valuya Guard.

`resource`
: the deterministic feature/payment key for this purchase flow.

`plan`
: the commercial plan name evaluated by Guard, usually `standard`.

`marketplace order`
: the Valuya order record for the Alfies basket.

`delegated payment`
: your app asks Guard to charge on behalf of the linked user wallet.

`checkout fallback`
: Guard returns a hosted payment URL when delegated payment is not possible or needs step-up.

## Subject strategy

Your app needs a stable Valuya subject per user.

Recommended canonical subject format:

```text
<subject_type>:<subject_id>
```

Examples:

```text
app_user:12345
customer:cus_9f2c
privy:user_abc123
```

Use the same subject consistently for:

- entitlement checks
- marketplace order creation
- delegated payment
- order submission / audit logs

Send it in the subject headers expected by Valuya:

```http
X-Valuya-Subject: app_user:12345
X-Valuya-Subject-Id: app_user:12345
```

## Resource naming

Use one deterministic resource for the Alfies purchase flow.

Recommended format:

```text
app:<your_app_slug>:merchant:alfies:grocery_checkout
```

Example:

```text
app:my-app:merchant:alfies:grocery_checkout
```

Do not generate a new resource per order. The order id is separate from the resource.

## Data your app must have before payment

Before calling Valuya, your backend should already know:

- the canonical Valuya subject
- the Alfies cart lines
- the final amount in cents
- currency, usually `EUR`
- asset, usually `EURe`
- a local order id from your app
- the Valuya marketplace product id representing Alfies checkout
- the merchant slug, usually `alfies`

Minimal cart line shape:

```json
[
  {
    "sku": "alfies-123",
    "name": "Bio Vollmilch 1L",
    "qty": 2,
    "unit_price_cents": 219
  }
]
```

## Recommended backend flow

### 1. Check whether access/payment is already active

Call:

```http
GET /api/v2/entitlements?plan=standard&resource=app:my-app:merchant:alfies:grocery_checkout
```

If active, you can skip payment creation and continue to order dispatch.

This is the same canonical Guard check described in [payment-flows.md](/home/colt/Software/valuya-guard/docs/payment-flows.md).

### 2. Create a Valuya marketplace order

Call:

```http
POST /api/marketplace/orders
```

Headers:

```http
Authorization: Bearer <tenant_token>
Content-Type: application/json
Accept: application/json
X-Valuya-Subject-Id: app_user:12345
Idempotency-Key: marketplace-order:<local_order_id>:v1
```

Example request body:

```json
{
  "guard_subject": { "type": "app_user", "external_id": "12345" },
  "protocol_subject_header": "app_user:12345",
  "product_id": 47,
  "merchant_slug": "alfies",
  "channel": "telegram",
  "resource": "app:my-app:merchant:alfies:grocery_checkout",
  "plan": "standard",
  "amount_cents": 438,
  "currency": "EUR",
  "asset": "EURe",
  "cart": [
    { "sku": "alfies-123", "name": "Bio Vollmilch 1L", "qty": 2, "unit_price_cents": 219 }
  ],
  "issue_checkout_token": false
}
```

Notes:

- `channel` is just a source label. Use a stable value for your app, for example `app`, `web`, or `mobile`, if your backend supports it.
- `product_id` is the Valuya marketplace product for Alfies checkout, not the Alfies SKU.
- `guard_subject` may be sent either as `{ "id": "..." }` or `{ "type": "...", "external_id": "..." }`.

### 3. Try delegated payment if the user has a linked wallet

If your user has a linked Guard-compatible wallet, call:

```http
POST /api/guard/payments/request
```

Headers:

```http
Authorization: Bearer <tenant_token>
Content-Type: application/json
Accept: application/json
X-Valuya-Subject-Id: app_user:12345
Idempotency-Key: app-delegated:<local_order_id>:v1
```

Example request body:

```json
{
  "subject": { "type": "app_user", "external_id": "12345" },
  "principal_subject_type": "app_user",
  "principal_subject_id": "12345",
  "wallet_address": "0x1234...abcd",
  "actor_type": "agent",
  "channel": "app",
  "scope": "commerce.order",
  "counterparty_type": "merchant",
  "counterparty_id": "alfies",
  "merchant_order_id": "ord_srv_123",
  "currency": "EUR",
  "asset": "EURe",
  "idempotency_key": "app-delegated:local_789:v1",
  "resource": "app:my-app:merchant:alfies:grocery_checkout",
  "plan": "standard"
}
```

Typical outcomes:

- success: payment completed or in settlement flow
- `requires_stepup`: user must complete hosted checkout
- insufficient balance / top-up required
- wallet missing or not allowlisted

### 4. Fall back to hosted checkout when delegated payment cannot complete

If delegated payment is unavailable or returns a step-up state, create a checkout link for the marketplace order:

```http
POST /api/marketplace/orders/{order_id}/checkout-link
```

Return `checkout_url` to the app and redirect the user there.

If you want the marketplace order creation step to return a checkout URL immediately, set:

```json
{ "issue_checkout_token": true }
```

on `POST /api/marketplace/orders`.

### 5. Re-check entitlement or order payment state after payment

After the user returns from checkout, do not assume payment completed.

Re-check using:

- `GET /api/v2/entitlements`
- optionally `GET /api/marketplace/orders/{order_id}`

Proceed only when Guard says the purchase is active / paid.

### 6. Dispatch the Alfies order

Once payment is confirmed, call your own order execution layer.

This can be:

- a direct Alfies API client
- an internal service that talks to Alfies
- a manual fulfillment backend

Valuya Guard should remain the payment and authorization system, not your Alfies cart engine.

## Minimal sequence

```text
App -> Your backend: checkout this Alfies cart
Your backend -> Valuya: GET /api/v2/entitlements
Your backend -> Valuya: POST /api/marketplace/orders
Your backend -> Valuya: POST /api/guard/payments/request
Valuya -> Your backend: paid | requires_stepup | topup_required
Your backend -> Valuya: POST /api/marketplace/orders/{id}/checkout-link  (if needed)
Your backend -> App: checkout_url or payment confirmed
App -> Your backend: user returned / retry status
Your backend -> Valuya: GET /api/v2/entitlements
Your backend -> Alfies service: place order
```

## Example backend pseudocode

```ts
async function checkoutAlfiesCart(input: {
  subjectType: string
  subjectId: string
  walletAddress?: string
  localOrderId: string
  cart: Array<{ sku: string; name: string; qty: number; unit_price_cents: number }>
}) {
  const protocolSubject = `${input.subjectType}:${input.subjectId}`
  const resource = "app:my-app:merchant:alfies:grocery_checkout"
  const plan = "standard"
  const amountCents = input.cart.reduce((sum, line) => sum + line.qty * line.unit_price_cents, 0)

  const entitlement = await getEntitlement({ protocolSubject, resource, plan })
  if (entitlement.active) {
    return await dispatchAlfiesOrder({ localOrderId: input.localOrderId, cart: input.cart })
  }

  const marketplace = await createMarketplaceOrder({
    protocolSubject,
    subjectType: input.subjectType,
    subjectId: input.subjectId,
    localOrderId: input.localOrderId,
    productId: 47,
    merchantSlug: "alfies",
    resource,
    plan,
    amountCents,
    currency: "EUR",
    asset: "EURe",
    cart: input.cart,
  })

  if (input.walletAddress) {
    const delegated = await tryDelegatedPayment({
      protocolSubject,
      subjectType: input.subjectType,
      subjectId: input.subjectId,
      walletAddress: input.walletAddress,
      merchantOrderId: marketplace.order.order_id,
      localOrderId: input.localOrderId,
      resource,
      plan,
    })

    if (delegated.kind === "paid") {
      return await dispatchAlfiesOrder({ localOrderId: input.localOrderId, cart: input.cart })
    }
  }

  const checkout = await createMarketplaceCheckoutLink({
    protocolSubject,
    orderId: marketplace.order.order_id,
  })

  return {
    status: "payment_required",
    checkoutUrl: checkout.checkout_url,
    valuyaOrderId: marketplace.order.order_id,
  }
}
```

## Idempotency rules

Use deterministic idempotency keys.

Recommended keys:

- marketplace order: `marketplace-order:<local_order_id>:v1`
- delegated payment: `app-delegated:<local_order_id>:v1`
- internal order dispatch: `alfies-dispatch:<local_order_id>:v1`

Do not create a new idempotency key for every retry of the same order attempt.

## Failure handling

Fail closed.

Do not place the Alfies order when:

- entitlement is inactive
- Valuya is unavailable
- marketplace order creation fails
- delegated payment fails without checkout completion
- subject mapping is missing or inconsistent

Return machine-readable states to the app, for example:

```json
{ "status": "payment_required", "checkout_url": "https://..." }
{ "status": "topup_required", "topup_url": "https://..." }
{ "status": "failed", "code": "marketplace_product_id_missing" }
```

## Required configuration

Your backend will typically need:

- `VALUYA_BASE`
- `VALUYA_TENANT_TOKEN`
- `VALUYA_RESOURCE`
- `VALUYA_PLAN`
- `MARKETPLACE_PRODUCT_ID`
- `MARKETPLACE_MERCHANT_SLUG=alfies`

If you support delegated payment:

- a linked user wallet address
- the correct Guard subject mapping for that wallet

## Existing references in this repo

These files show the current Alfies integration shape:

- [packages/telegram-bot/examples/alfies-concierge/README.md](/home/colt/Software/valuya-guard/packages/telegram-bot/examples/alfies-concierge/README.md)
- [packages/telegram-bot/examples/alfies-concierge/marketplaceOrders.ts](/home/colt/Software/valuya-guard/packages/telegram-bot/examples/alfies-concierge/marketplaceOrders.ts)
- [packages/telegram-bot/examples/alfies-concierge/delegatedPayment.ts](/home/colt/Software/valuya-guard/packages/telegram-bot/examples/alfies-concierge/delegatedPayment.ts)
- [packages/telegram-bot/src/orderBackend.ts](/home/colt/Software/valuya-guard/packages/telegram-bot/src/orderBackend.ts)
- [packages/whatsapp-bot/src/valuyaPay.ts](/home/colt/Software/valuya-guard/packages/whatsapp-bot/src/valuyaPay.ts)

## Recommendation

For a new external app, start with this order of implementation:

1. subject mapping
2. entitlement check
3. marketplace order creation
4. hosted checkout fallback
5. delegated payment optimization
6. Alfies dispatch after confirmed payment

That keeps the first version simple while still using Valuya Guard correctly.
