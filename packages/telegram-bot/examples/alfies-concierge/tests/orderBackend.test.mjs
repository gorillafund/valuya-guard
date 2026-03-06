import test from "node:test"
import assert from "node:assert/strict"

import {
  buildOrderPayload,
  sendOrderToBackendRequest,
  submitOrderWithEntitlementGuard,
  waitForActiveEntitlementState,
} from "../dist/telegram-bot/examples/alfies-concierge/orderBackend.js"

test("buildOrderPayload maps cart items and defaults qty", () => {
  const payload = buildOrderPayload({
    orderId: "67658",
    resource: "telegram:bot:alfies:order",
    plan: "standard",
    recipeTitle: "Veggie Pasta",
    totalCents: 1299,
    cartItems: [
      { sku: "A-1", name: "Tomato", qty: 2, unit_price_cents: 199 },
      { sku: "B-2", name: "Olive Oil" },
      { sku: "", name: "Invalid" },
    ],
  })

  assert.equal(payload.order_id, "67658")
  assert.equal(payload.source, "telegram")
  assert.equal(payload.customer_number, "89733")
  assert.equal(payload.resource, "telegram:bot:alfies:order")
  assert.equal(payload.plan, "standard")
  assert.equal(payload.delivery.type, "sofort")
  assert.equal(payload.products.length, 2)
  assert.deepEqual(payload.products[0], {
    sku: "A-1",
    name: "Tomato",
    qty: 2,
    unit_price_cents: 199,
  })
  assert.deepEqual(payload.products[1], {
    sku: "B-2",
    name: "Olive Oil",
    qty: 1,
  })
  assert.equal(payload.meta.recipe_title, "Veggie Pasta")
  assert.equal(payload.meta.total_cents, 1299)
})

test("sendOrderToBackendRequest retries on 5xx and succeeds", async () => {
  let calls = 0
  const fetchImpl = async () => {
    calls += 1
    if (calls < 3) {
      return new Response(JSON.stringify({ error: "temporary" }), {
        status: 503,
        headers: { "Content-Type": "application/json" },
      })
    }
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    })
  }

  const payload = buildOrderPayload({
    orderId: "ord_1",
    resource: "telegram:bot:alfies:order",
    plan: "standard",
  })
  const result = await sendOrderToBackendRequest({
    baseUrl: "https://pay.gorilla.build",
    token: "ttok_x",
    subjectId: "telegram:123",
    orderPayload: payload,
    fetchImpl,
    maxRetries: 2,
    initialBackoffMs: 1,
  })

  assert.deepEqual(result, { ok: true })
  assert.equal(calls, 3)
})

test("sendOrderToBackendRequest attaches usage proof in header and payload", async () => {
  let capturedHeaders = null
  let capturedBody = null
  const payload = buildOrderPayload({
    orderId: "ord_usage_1",
    resource: "telegram:bot:alfies:order",
    plan: "standard",
  })
  const result = await sendOrderToBackendRequest({
    baseUrl: "https://pay.gorilla.build",
    token: "ttok_x",
    subjectId: "telegram:123",
    orderPayload: payload,
    usageIdempotencyKey: "alfies-order:ord_usage_1:v1",
    fetchImpl: async (_url, init) => {
      capturedHeaders = init.headers
      capturedBody = JSON.parse(init.body)
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    },
    maxRetries: 0,
  })

  assert.deepEqual(result, { ok: true })
  assert.equal(
    capturedHeaders["X-Valuya-Usage-Idempotency-Key"],
    "alfies-order:ord_usage_1:v1",
  )
  assert.equal(
    capturedBody.usage_idempotency_key,
    "alfies-order:ord_usage_1:v1",
  )
})

test("active entitlement => order submitted", async () => {
  let sent = 0
  const result = await submitOrderWithEntitlementGuard({
    checkEntitlement: async () => ({ active: true, reason: "mandate_active" }),
    sendOrder: async () => {
      sent += 1
      return { ok: true }
    },
  })

  assert.equal(sent, 1)
  assert.equal(result.submitted, true)
})

test("inactive entitlement => order blocked and payment flow triggered", async () => {
  let sent = 0
  let paymentFlow = 0
  const result = await submitOrderWithEntitlementGuard({
    checkEntitlement: async () => ({ active: false, reason: "payment_required" }),
    sendOrder: async () => {
      sent += 1
      return { ok: true }
    },
    onPaymentRequired: async () => {
      paymentFlow += 1
    },
  })

  assert.equal(sent, 0)
  assert.equal(paymentFlow, 1)
  assert.equal(result.submitted, false)
  assert.equal(result.reason, "payment_required")
})

test("invalid subject header => blocked before request", async () => {
  let calls = 0
  const payload = buildOrderPayload({
    orderId: "ord_2",
    resource: "telegram:bot:alfies:order",
    plan: "standard",
  })
  await assert.rejects(
    () =>
      sendOrderToBackendRequest({
        baseUrl: "https://pay.gorilla.build",
        token: "ttok_x",
        subjectId: "invalid-subject",
        orderPayload: payload,
        fetchImpl: async () => {
          calls += 1
          return new Response("{}", { status: 200 })
        },
      }),
    /subject_invalid/,
  )
  assert.equal(calls, 0)
})

test("missing resource/plan => validation fails before request", async () => {
  assert.throws(
    () =>
      buildOrderPayload({
        orderId: "ord_3",
        resource: "",
        plan: "standard",
      }),
    /resource_required/,
  )

  assert.throws(
    () =>
      buildOrderPayload({
        orderId: "ord_4",
        resource: "telegram:bot:alfies:order",
        plan: "",
      }),
    /plan_required/,
  )
})

test("verify confirmed + entitlement active => order sent", async () => {
  let sent = 0
  const wait = await waitForActiveEntitlementState({
    checkEntitlement: async () => ({ active: true, reason: "mandate_active" }),
    maxAttempts: 3,
    delaysMs: [1, 1, 1],
    sleepFn: async () => {},
  })
  if (wait.active) sent += 1
  assert.equal(wait.active, true)
  assert.equal(sent, 1)
})

test("verify confirmed + entitlement delayed => retries then sent", async () => {
  let checks = 0
  let sent = 0
  const wait = await waitForActiveEntitlementState({
    checkEntitlement: async () => {
      checks += 1
      if (checks < 3) return { active: false, reason: "pending" }
      return { active: true, reason: "mandate_active" }
    },
    maxAttempts: 5,
    delaysMs: [1, 1, 1, 1, 1],
    sleepFn: async () => {},
  })
  if (wait.active) sent += 1
  assert.equal(wait.active, true)
  assert.equal(checks, 3)
  assert.equal(sent, 1)
})

test("verify confirmed + entitlement timeout => no order sent", async () => {
  let sent = 0
  const wait = await waitForActiveEntitlementState({
    checkEntitlement: async () => ({ active: false, reason: "no_mandate" }),
    maxAttempts: 3,
    delaysMs: [1, 1, 1],
    sleepFn: async () => {},
  })
  if (wait.active) sent += 1
  assert.equal(wait.active, false)
  assert.equal(sent, 0)
})

test("no duplicate order on retry path", async () => {
  let checks = 0
  let sent = 0
  const wait = await waitForActiveEntitlementState({
    checkEntitlement: async () => {
      checks += 1
      if (checks < 4) return { active: false, reason: "pending" }
      return { active: true, reason: "mandate_active" }
    },
    maxAttempts: 6,
    delaysMs: [1, 1, 1, 1, 1, 1],
    sleepFn: async () => {},
  })
  if (wait.active) {
    sent += 1
  }
  assert.equal(wait.active, true)
  assert.equal(sent, 1)
})
