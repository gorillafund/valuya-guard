import test from "node:test"
import assert from "node:assert/strict"
import { createAgentOrderForDelegatedPayment } from "../dist/telegram-bot/examples/alfies-concierge/agentOrder.js"

test("successful order creation returns server order_id for delegated payment", async () => {
  const calls = []
  const result = await createAgentOrderForDelegatedPayment({
    baseUrl: "https://guard.example",
    tenantToken: "ttok_usage_123",
    subjectHeader: "user:17",
    localOrderIdCandidate: "local-dev-order-id",
    orderPayload: {
      order_id: "local-dev-order-id",
      source: "telegram",
      customer_number: "89733",
      resource: "telegram:bot:x:recipe",
      plan: "standard",
      delivery: { type: "sofort" },
      delivery_address: {
        street: "Kaiserstrasse 8/7a",
        postal_code: "1070",
        city: "Wien",
        country: "AT",
      },
      products: [],
      meta: {},
    },
    fetchImpl: async (url, init) => {
      calls.push({ url: String(url), init })
      return new Response(JSON.stringify({ ok: true, order_id: "srv_order_123" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    },
  })

  assert.equal(calls.length, 1)
  assert.equal(calls[0].url, "https://guard.example/api/agent/orders")
  assert.equal(result.merchantOrderId, "srv_order_123")
})

test("delegated payment path fails early when server order_id is missing", async () => {
  await assert.rejects(
    createAgentOrderForDelegatedPayment({
      baseUrl: "https://guard.example",
      tenantToken: "ttok_usage_123",
      subjectHeader: "user:17",
      localOrderIdCandidate: "local-dev-order-id",
      orderPayload: {
        order_id: "local-dev-order-id",
        source: "telegram",
        customer_number: "89733",
        resource: "telegram:bot:x:recipe",
        plan: "standard",
        delivery: { type: "sofort" },
        delivery_address: {
          street: "Kaiserstrasse 8/7a",
          postal_code: "1070",
          city: "Wien",
          country: "AT",
        },
        products: [],
        meta: {},
      },
      fetchImpl: async () =>
        new Response(JSON.stringify({ ok: true, created: true }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
    }),
    /agent_order_id_missing_fail_safe/,
  )
})

test("agent order create exposes payment_required metadata on 402", async () => {
  let capturedError
  try {
    await createAgentOrderForDelegatedPayment({
      baseUrl: "https://guard.example",
      tenantToken: "ttok_usage_123",
      subjectHeader: "user:17",
      localOrderIdCandidate: "local-dev-order-id",
      orderPayload: {
        order_id: "local-dev-order-id",
        source: "telegram",
        customer_number: "89733",
        resource: "telegram:bot:x:recipe",
        plan: "standard",
        delivery: { type: "sofort" },
        delivery_address: {
          street: "Kaiserstrasse 8/7a",
          postal_code: "1070",
          city: "Wien",
          country: "AT",
        },
        products: [],
        meta: {},
      },
      fetchImpl: async () =>
        new Response(JSON.stringify({ ok: false, error: "payment_required", state: "no_mandate" }), {
          status: 402,
          headers: { "Content-Type": "application/json" },
        }),
    })
  } catch (error) {
    capturedError = error
  }

  assert.ok(capturedError)
  assert.equal(capturedError.status, 402)
  assert.equal(capturedError.code, "payment_required")
})
