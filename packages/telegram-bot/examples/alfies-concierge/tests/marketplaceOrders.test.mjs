import test from "node:test"
import assert from "node:assert/strict"
import {
  createMarketplaceOrderIntent,
  createMarketplaceCheckoutLink,
  getMarketplaceOrder,
} from "../dist/telegram-bot/examples/alfies-concierge/marketplaceOrders.js"

test("creates marketplace order intent with guard subject and returns checkout_url", async () => {
  const calls = []
  const response = await createMarketplaceOrderIntent({
    baseUrl: "https://guard.example",
    tenantToken: "ttok_123",
    guardSubject: { id: "16" },
    protocolSubjectHeader: "user:17",
    productId: 47,
    merchantSlug: "alfies",
    channel: "telegram",
    resource: "telegram:bot:test:recipe_confirm",
    plan: "standard",
    amountCents: 827,
    currency: "EUR",
    asset: "EURe",
    cart: { items: [{ sku: "paella", name: "Paella", qty: 1, unit_price_cents: 827 }] },
    localOrderId: "ord_local_1",
    fetchImpl: async (url, init) => {
      calls.push({ url, init })
      return new Response(
        JSON.stringify({
          ok: true,
          order: { order_id: "ord_srv_1", guard_subject_id: 16, protocol_subject_header: "user:17" },
          checkout_url: "https://guard.example/checkout/orders/aco_1",
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      )
    },
  })

  assert.equal(calls[0].url, "https://guard.example/api/marketplace/orders")
  const reqBody = JSON.parse(String(calls[0].init.body))
  assert.deepEqual(reqBody.guard_subject, { id: "16" })
  assert.equal(reqBody.protocol_subject_header, "user:17")
  assert.equal(reqBody.product_id, 47)
  assert.equal(reqBody.merchant_slug, "alfies")
  assert.equal(reqBody.channel, "telegram")
  assert.equal(reqBody.resource, "telegram:bot:test:recipe_confirm")
  assert.equal(reqBody.plan, "standard")
  assert.equal(reqBody.amount_cents, 827)
  assert.equal(response.order.order_id, "ord_srv_1")
  assert.equal(response.checkout_url, "https://guard.example/checkout/orders/aco_1")
})

test("order intent requires guard subject and does not accept protocol subject as guard subject", async () => {
  await assert.rejects(
    () =>
      createMarketplaceOrderIntent({
        baseUrl: "https://guard.example",
        tenantToken: "ttok_123",
        guardSubject: { id: "" },
        protocolSubjectHeader: "user:17",
        productId: 47,
        merchantSlug: "alfies",
        channel: "telegram",
        resource: "telegram:bot:test:recipe_confirm",
        plan: "standard",
        amountCents: 827,
        currency: "EUR",
        asset: "EURe",
        cart: { items: [] },
        localOrderId: "ord_local_2",
        fetchImpl: async () => new Response("{}", { status: 200 }),
      }),
    /marketplace_guard_subject_missing_fail_safe/,
  )
})

test("order intent requires protocol subject header for step-up fallback", async () => {
  await assert.rejects(
    () =>
      createMarketplaceOrderIntent({
        baseUrl: "https://guard.example",
        tenantToken: "ttok_123",
        guardSubject: { id: "16" },
        protocolSubjectHeader: "",
        productId: 47,
        merchantSlug: "alfies",
        channel: "telegram",
        resource: "telegram:bot:test:recipe_confirm",
        plan: "standard",
        amountCents: 827,
        currency: "EUR",
        asset: "EURe",
        cart: { items: [] },
        localOrderId: "ord_local_3",
        fetchImpl: async () => new Response("{}", { status: 200 }),
      }),
    /marketplace_protocol_subject_missing_fail_safe/,
  )
})

test("order intent fails early when product_id is missing", async () => {
  await assert.rejects(
    () =>
      createMarketplaceOrderIntent({
        baseUrl: "https://guard.example",
        tenantToken: "ttok_123",
        guardSubject: { id: "16" },
        protocolSubjectHeader: "user:17",
        productId: 0,
        merchantSlug: "alfies",
        channel: "telegram",
        resource: "telegram:bot:test:recipe_confirm",
        plan: "standard",
        amountCents: 827,
        currency: "EUR",
        asset: "EURe",
        cart: { items: [] },
        localOrderId: "ord_local_4",
        fetchImpl: async () => new Response("{}", { status: 200 }),
      }),
    /marketplace_product_id_missing_fail_safe/,
  )
})

test("order intent fails early when resource is missing", async () => {
  await assert.rejects(
    () =>
      createMarketplaceOrderIntent({
        baseUrl: "https://guard.example",
        tenantToken: "ttok_123",
        guardSubject: { id: "16" },
        protocolSubjectHeader: "user:17",
        productId: 47,
        merchantSlug: "alfies",
        channel: "telegram",
        resource: "",
        plan: "standard",
        amountCents: 827,
        currency: "EUR",
        asset: "EURe",
        cart: { items: [] },
        localOrderId: "ord_local_5",
        fetchImpl: async () => new Response("{}", { status: 200 }),
      }),
    /marketplace_resource_missing_fail_safe/,
  )
})

test("supports GET marketplace order and checkout-link endpoints", async () => {
  const calls = []
  const fetchImpl = async (url, init) => {
    calls.push({ url, init })
    if (String(url).endsWith("/checkout-link")) {
      return new Response(JSON.stringify({ ok: true, checkout_url: "https://guard.example/checkout/orders/aco_2" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    }
    return new Response(JSON.stringify({ ok: true, order: { order_id: "ord_srv_2", status: "awaiting_checkout" } }), {
      status: 200,
      headers: { "content-type": "application/json" },
    })
  }

  const read = await getMarketplaceOrder({
    baseUrl: "https://guard.example",
    tenantToken: "ttok_123",
    orderId: "ord_srv_2",
    protocolSubjectHeader: "user:17",
    fetchImpl,
  })
  const checkout = await createMarketplaceCheckoutLink({
    baseUrl: "https://guard.example",
    tenantToken: "ttok_123",
    orderId: "ord_srv_2",
    protocolSubjectHeader: "user:17",
    fetchImpl,
  })

  assert.equal(read.order.order_id, "ord_srv_2")
  assert.equal(checkout.checkout_url, "https://guard.example/checkout/orders/aco_2")
  assert.equal(calls[0].url, "https://guard.example/api/marketplace/orders/ord_srv_2")
  assert.equal(calls[1].url, "https://guard.example/api/marketplace/orders/ord_srv_2/checkout-link")
})
