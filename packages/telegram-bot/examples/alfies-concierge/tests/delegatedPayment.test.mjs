import test from "node:test"
import assert from "node:assert/strict"
import { requestDelegatedPayment } from "../dist/telegram-bot/examples/alfies-concierge/delegatedPayment.js"

test("linked Telegram user purchase goes through Guard delegated payment endpoint", async () => {
  const calls = []
  const body = await requestDelegatedPayment({
    baseUrl: "https://guard.example",
    tenantToken: "ttok_usage_123",
    protocolSubjectHeader: "user:17",
    guardSubjectId: "16",
    guardSubjectType: "privy_user",
    guardSubjectExternalId: "did:privy:abc",
    principalSubjectType: "user",
    principalSubjectId: "17",
    walletAddress: "0x563efeff9fb7d6fd0243e5b9cf620690b69058a7",
    actorType: "agent",
    channel: "telegram",
    scope: "commerce.order",
    counterpartyType: "merchant",
    counterpartyId: "alfies",
    merchantOrderId: "ord_123",
    currency: "EUR",
    asset: "USDC",
    idempotencyKey: "idem_123",
    resource: "telegram:bot:x:recipe",
    plan: "standard",
    fetchImpl: async (url, init) => {
      calls.push({ url: String(url), init })
      return new Response(JSON.stringify({ ok: true, payment_id: "pay_123" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    },
  })

  assert.equal(calls.length, 1)
  assert.equal(calls[0].url, "https://guard.example/api/guard/payments/request")
  const reqBody = JSON.parse(String(calls[0].init?.body || "{}"))
  assert.equal(reqBody.subject.id, "16")
  assert.equal(reqBody.subject.type, undefined)
  assert.equal(reqBody.principal_subject_type, "user")
  assert.equal(reqBody.principal_subject_id, "17")
  assert.equal(reqBody.wallet_address, "0x563efeff9fb7d6fd0243e5b9cf620690b69058a7")
  assert.equal(reqBody.actor_type, "agent")
  assert.equal(reqBody.channel, "telegram")
  assert.equal(reqBody.scope, "commerce.order")
  assert.equal(reqBody.counterparty_type, "merchant")
  assert.equal(reqBody.counterparty_id, "alfies")
  assert.equal(reqBody.merchant_order_id, "ord_123")
  assert.deepEqual(body, { ok: true, payment_id: "pay_123" })
})

test("delegated payment failure surfaces an explicit error", async () => {
  await assert.rejects(
    requestDelegatedPayment({
      baseUrl: "https://guard.example",
      tenantToken: "ttok_usage_123",
      protocolSubjectHeader: "user:17",
      guardSubjectId: "16",
      principalSubjectType: "user",
      principalSubjectId: "17",
      walletAddress: "0x563efeff9fb7d6fd0243e5b9cf620690b69058a7",
      actorType: "agent",
      channel: "telegram",
      scope: "commerce.order",
      counterpartyType: "merchant",
      counterpartyId: "alfies",
      merchantOrderId: "ord_123",
      currency: "EUR",
      asset: "USDC",
      idempotencyKey: "idem_123",
      resource: "telegram:bot:x:recipe",
      plan: "standard",
      fetchImpl: async () =>
        new Response(JSON.stringify({ ok: false, code: "wallet_not_allowlisted" }), {
          status: 403,
          headers: { "Content-Type": "application/json" },
        }),
    }),
    /delegated_payment_request_failed:403/,
  )
})

test("delegated payment fails early when merchant_order_id is missing", async () => {
  await assert.rejects(
    requestDelegatedPayment({
      baseUrl: "https://guard.example",
      tenantToken: "ttok_usage_123",
      protocolSubjectHeader: "user:17",
      guardSubjectId: "16",
      principalSubjectType: "user",
      principalSubjectId: "17",
      walletAddress: "0x563efeff9fb7d6fd0243e5b9cf620690b69058a7",
      actorType: "agent",
      channel: "telegram",
      scope: "commerce.order",
      counterpartyType: "merchant",
      counterpartyId: "alfies",
      merchantOrderId: "",
      currency: "EUR",
      asset: "USDC",
      idempotencyKey: "idem_123",
      resource: "telegram:bot:x:recipe",
      plan: "standard",
      fetchImpl: async () => {
        throw new Error("fetch_should_not_be_called")
      },
    }),
    /delegated_payment_input_missing_fail_safe/,
  )
})

test("delegated payment supports amount fallback when merchant order id is unavailable", async () => {
  const calls = []
  await requestDelegatedPayment({
    baseUrl: "https://guard.example",
    tenantToken: "ttok_usage_123",
    protocolSubjectHeader: "user:17",
    guardSubjectType: "privy_user",
    guardSubjectExternalId: "did:privy:abc",
    principalSubjectType: "user",
    principalSubjectId: "17",
    walletAddress: "0x563efeff9fb7d6fd0243e5b9cf620690b69058a7",
    actorType: "agent",
    channel: "telegram",
    scope: "commerce.order",
    counterpartyType: "merchant",
    counterpartyId: "alfies",
    merchantOrderId: "",
    amountCents: 1299,
    currency: "EUR",
    asset: "USDC",
    cart: [{ sku: "1", qty: 1, unit_price_cents: 1299 }],
    idempotencyKey: "idem_123",
    resource: "telegram:bot:x:recipe",
    plan: "standard",
    fetchImpl: async (url, init) => {
      calls.push({ url: String(url), init })
      return new Response(JSON.stringify({ ok: true, payment_id: "pay_123" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    },
  })
  const body = JSON.parse(String(calls[0].init?.body || "{}"))
  assert.equal(body.subject.id, undefined)
  assert.equal(body.subject.type, "privy_user")
  assert.equal(body.subject.external_id, "did:privy:abc")
  assert.equal(body.merchant_order_id, undefined)
  assert.equal(body.amount_cents, 1299)
})
