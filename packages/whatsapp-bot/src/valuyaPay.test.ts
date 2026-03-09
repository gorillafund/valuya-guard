import test from "node:test"
import assert from "node:assert/strict"
import type { AgentConfig } from "@valuya/agent"
import { ValuyaPayClient } from "./valuyaPay.js"

type MockResponse = {
  status: number
  body: unknown
}

test("linked user payment uses guard subject + linked wallet for delegated request", async () => {
  const requests: Array<{ url: string; init: RequestInit | undefined }> = []
  const responses: MockResponse[] = [
    { status: 200, body: { ok: true } }, // whoami
    { status: 200, body: { ok: true, order: { order_id: "ord_srv_1" } } }, // marketplace/orders
    { status: 200, body: { ok: true, state: "approved" } }, // delegated
    { status: 200, body: { active: true } }, // entitlement after
  ]

  await withMockFetch(responses, requests, async () => {
    const client = new ValuyaPayClient({
      cfg: cfg(),
      backendBaseUrl: "https://backend.example",
      backendToken: "backend-token",
      resource: "whatsapp:bot:test:recipe",
      plan: "standard",
      marketplaceProductId: 47,
      entitlementPollDelaysMs: [0],
    })

    const result = await client.ensurePaid({
      subject: { type: "user", id: "17" },
      orderId: "ord_1",
      amountCents: 827,
      currency: "EUR",
      actorType: "agent",
      channel: "whatsapp",
      protocolSubjectHeader: "user:17",
      guardSubjectId: "16",
      guardSubjectType: "privy_user",
      guardSubjectExternalId: "did:privy:abc123",
      linkedWalletAddress: "0x563eFeff9fb7D6FD0243E5b9Cf620690b69058A7",
    })

    assert.equal(result.ok, true)

    const delegated = requests.find((r) =>
      r.url.includes("/api/guard/payments/request"),
    )
    assert.ok(delegated)
    const headers = new Headers(delegated?.init?.headers)
    assert.equal(headers.get("x-valuya-subject-id"), "user:17")
    const body = JSON.parse(String(delegated?.init?.body || "{}")) as Record<string, unknown>
    assert.deepEqual(body.subject, { id: "16" })
    assert.equal(body.principal_subject_type, "user")
    assert.equal(body.principal_subject_id, "17")
    assert.equal(body.wallet_address, "0x563efeff9fb7d6fd0243e5b9cf620690b69058a7")
    assert.equal(body.merchant_order_id, "ord_srv_1")
    assert.equal(body.amount_cents, undefined)
    assert.equal(
      requests.some((r) => r.url.includes("/api/agent/orders")),
      false,
    )
  })
})

test("delegated payment prefers whoami principal subject when available", async () => {
  const requests: Array<{ url: string; init: RequestInit | undefined }> = []
  const responses: MockResponse[] = [
    {
      status: 200,
      body: {
        ok: true,
        principal: {
          subject: {
            type: "user",
            id: "44",
          },
        },
      },
    },
    { status: 200, body: { ok: true, order: { order_id: "ord_srv_whoami" } } },
    { status: 200, body: { ok: true, state: "approved" } },
    { status: 200, body: { active: true } },
  ]

  await withMockFetch(responses, requests, async () => {
    const client = new ValuyaPayClient({
      cfg: cfg(),
      backendBaseUrl: "https://backend.example",
      backendToken: "backend-token",
      resource: "whatsapp:bot:test:recipe",
      plan: "standard",
      marketplaceProductId: 47,
      entitlementPollDelaysMs: [0],
    })

    const result = await client.ensurePaid({
      subject: { type: "user", id: "17" },
      orderId: "ord_whoami_principal",
      amountCents: 827,
      currency: "EUR",
      actorType: "agent",
      channel: "whatsapp",
      protocolSubjectHeader: "user:17",
      guardSubjectId: "16",
      guardSubjectType: "privy_user",
      guardSubjectExternalId: "did:privy:abc123",
      linkedWalletAddress: "0x563eFeff9fb7D6FD0243E5b9Cf620690b69058A7",
    })

    assert.equal(result.ok, true)

    const delegated = requests.find((r) => r.url.includes("/api/guard/payments/request"))
    assert.ok(delegated)
    const body = JSON.parse(String(delegated?.init?.body || "{}")) as Record<string, unknown>
    assert.equal(body.principal_subject_type, "user")
    assert.equal(body.principal_subject_id, "44")
  })
})

test("delegated payment marketplace order includes cart items and skips checkout token creation", async () => {
  const requests: Array<{ url: string; init: RequestInit | undefined }> = []
  const responses: MockResponse[] = [
    { status: 200, body: { ok: true } },
    { status: 200, body: { ok: true, order: { order_id: "ord_srv_1" } } },
    { status: 200, body: { ok: true, state: "approved" } },
    { status: 200, body: { active: true } },
  ]

  await withMockFetch(responses, requests, async () => {
    const client = new ValuyaPayClient({
      cfg: cfg(),
      backendBaseUrl: "https://backend.example",
      backendToken: "backend-token",
      resource: "whatsapp:bot:test:recipe",
      plan: "standard",
      marketplaceProductId: 47,
      entitlementPollDelaysMs: [0],
    })

    const result = await client.ensurePaid({
      subject: { type: "user", id: "17" },
      orderId: "ord_products",
      amountCents: 827,
      currency: "EUR",
      actorType: "agent",
      channel: "whatsapp",
      protocolSubjectHeader: "user:17",
      guardSubjectId: "16",
      linkedWalletAddress: "0x563eFeff9fb7D6FD0243E5b9Cf620690b69058A7",
      cart: [{ sku: "paella", name: "Paella", qty: 1, unit_price_cents: 827 }],
      recipe: { title: "Paella" },
    })

    assert.equal(result.ok, true)

    const orderCreate = requests.find((r) => r.url.includes("/api/marketplace/orders"))
    assert.ok(orderCreate)
    const body = JSON.parse(String(orderCreate?.init?.body || "{}")) as Record<string, unknown>
    assert.equal((body.cart as { items?: unknown[] } | undefined)?.items?.length, 1)
    assert.equal(body.issue_checkout_token, false)
    assert.equal(
      requests.some((r) => r.url.includes("/api/agent/orders")),
      false,
    )
  })
})

test("missing linked wallet fails safely and never calls delegated payment", async () => {
  const requests: Array<{ url: string; init: RequestInit | undefined }> = []
  const responses: MockResponse[] = [
    { status: 200, body: { ok: true } }, // whoami
  ]

  await withMockFetch(responses, requests, async () => {
    const client = new ValuyaPayClient({
      cfg: cfg(),
      backendBaseUrl: "https://backend.example",
      backendToken: "backend-token",
      resource: "whatsapp:bot:test:recipe",
      plan: "standard",
      marketplaceProductId: 47,
      entitlementPollDelaysMs: [0],
    })

    const result = await client.ensurePaid({
      subject: { type: "user", id: "17" },
      orderId: "ord_2",
      amountCents: 827,
      protocolSubjectHeader: "user:17",
      guardSubjectId: "16",
      linkedWalletAddress: undefined,
    })

    assert.equal(result.ok, false)
    if (result.ok) return
    assert.equal(result.reason, "linked_wallet_missing_fail_safe")
    assert.equal(
      requests.some((r) => r.url.includes("/api/guard/payments/request")),
      false,
    )
  })
})

test("requires_stepup creates marketplace order with product/resource/plan", async () => {
  const requests: Array<{ url: string; init: RequestInit | undefined }> = []
  const responses: MockResponse[] = [
    { status: 200, body: { ok: true } }, // whoami
    {
      status: 200,
      body: {
        ok: true,
        order: { order_id: "ord_srv_1", status: "awaiting_checkout" },
      },
    }, // marketplace order
    { status: 200, body: { ok: true, state: "requires_stepup" } }, // delegated
    {
      status: 200,
      body: {
        ok: true,
        checkout_url: "https://guard.example/checkout/orders/aco_1",
      },
    }, // checkout link
  ]

  await withMockFetch(responses, requests, async () => {
    const client = new ValuyaPayClient({
      cfg: cfg(),
      backendBaseUrl: "https://backend.example",
      backendToken: "backend-token",
      resource: "telegram:bot:test:recipe_confirm",
      plan: "standard",
      marketplaceProductId: 47,
      marketplaceMerchantSlug: "alfies",
      entitlementPollDelaysMs: [0],
    })

    const result = await client.ensurePaid({
      subject: { type: "user", id: "17" },
      orderId: "ord_3",
      amountCents: 827,
      currency: "EUR",
      actorType: "agent",
      channel: "whatsapp",
      protocolSubjectHeader: "user:17",
      guardSubjectId: "16",
      linkedWalletAddress: "0x563eFeff9fb7D6FD0243E5b9Cf620690b69058A7",
      cart: [{ sku: "paella", name: "Paella", qty: 1, unit_price_cents: 827 }],
    })

    assert.equal(result.ok, false)
    if (result.ok) return
    assert.equal(result.reason, "payment_stepup_required")
    assert.equal(result.checkoutUrl, "https://guard.example/checkout/orders/aco_1")

    const marketplace = requests.find((r) => r.url.includes("/api/marketplace/orders"))
    assert.ok(marketplace)
    const body = JSON.parse(String(marketplace?.init?.body || "{}")) as Record<string, unknown>
    assert.equal(body.product_id, 47)
    assert.equal(body.resource, "telegram:bot:test:recipe_confirm")
    assert.equal(body.plan, "standard")
    assert.equal(body.protocol_subject_header, "user:17")
    assert.equal(body.issue_checkout_token, false)
  })
})

test("payment_estimation_failed returns topup path and does not create checkout fallback", async () => {
  const requests: Array<{ url: string; init: RequestInit | undefined }> = []
  const responses: MockResponse[] = [
    { status: 200, body: { ok: true } }, // whoami
    { status: 200, body: { ok: true, order: { order_id: "ord_srv_topup" } } }, // marketplace order
    {
      status: 422,
      body: {
        ok: false,
        code: "payment_estimation_failed",
        message: "Insufficient balance for delegated payment.",
        topup_url: "https://guard.example/topup/wallet",
      },
    }, // delegated payment
  ]

  await withMockFetch(responses, requests, async () => {
    const client = new ValuyaPayClient({
      cfg: cfg(),
      backendBaseUrl: "https://backend.example",
      backendToken: "backend-token",
      resource: "whatsapp:bot:test:recipe",
      plan: "standard",
      marketplaceProductId: 47,
      entitlementPollDelaysMs: [0],
    })

    const result = await client.ensurePaid({
      subject: { type: "user", id: "17" },
      orderId: "ord_topup",
      amountCents: 1,
      currency: "EUR",
      actorType: "agent",
      channel: "whatsapp",
      protocolSubjectHeader: "user:17",
      guardSubjectId: "16",
      linkedWalletAddress: "0x563eFeff9fb7D6FD0243E5b9Cf620690b69058A7",
      cart: [{ sku: "one-cent", name: "One Cent", qty: 1, unit_price_cents: 1 }],
    })

    assert.equal(result.ok, false)
    if (result.ok) return
    assert.equal(result.topupUrl, "https://guard.example/topup/wallet")
    assert.equal(result.checkoutUrl, undefined)
    assert.equal(
      requests.some((r) => r.url.includes("/api/marketplace/orders")),
      true,
    )
    assert.equal(
      requests.some((r) => r.url.includes("/api/agent/orders")),
      false,
    )
  })
})

test("pending_settlement polls entitlement before failing", async () => {
  const requests: Array<{ url: string; init: RequestInit | undefined }> = []
  const responses: MockResponse[] = [
    { status: 200, body: { ok: true } }, // whoami
    { status: 200, body: { ok: true, order: { order_id: "ord_srv_pending" } } }, // marketplace order
    { status: 200, body: { ok: true, session: { state: "pending_settlement" } } }, // delegated
    { status: 200, body: { active: false } }, // poll 1
    { status: 200, body: { active: false } }, // poll 2
    { status: 200, body: { active: true } }, // poll 3
  ]
  const sleeps: number[] = []

  await withMockFetch(responses, requests, async () => {
    const client = new ValuyaPayClient({
      cfg: cfg(),
      backendBaseUrl: "https://backend.example",
      backendToken: "backend-token",
      resource: "whatsapp:bot:test:recipe",
      plan: "standard",
      marketplaceProductId: 47,
      entitlementPollDelaysMs: [0, 4, 8],
      sleepFn: async (ms) => {
        sleeps.push(ms)
      },
    })

    const result = await client.ensurePaid({
      subject: { type: "user", id: "17" },
      orderId: "ord_pending",
      amountCents: 1,
      currency: "EUR",
      actorType: "agent",
      channel: "whatsapp",
      protocolSubjectHeader: "user:17",
      guardSubjectId: "16",
      linkedWalletAddress: "0x563eFeff9fb7D6FD0243E5b9Cf620690b69058A7",
      cart: [{ sku: "one-cent", name: "One Cent", qty: 1, unit_price_cents: 1 }],
    })

    assert.equal(result.ok, true)
    assert.deepEqual(sleeps, [4, 8])
  })
})

test("pending_settlement timeout stays pending instead of surfacing generic failure", async () => {
  const requests: Array<{ url: string; init: RequestInit | undefined }> = []
  const responses: MockResponse[] = [
    { status: 200, body: { ok: true } }, // whoami
    { status: 200, body: { ok: true, order: { order_id: "ord_srv_pending_timeout" } } }, // marketplace order
    { status: 200, body: { ok: true, session: { state: "pending_settlement" } } }, // delegated
    { status: 200, body: { active: false } }, // poll 1
    { status: 200, body: { active: false } }, // poll 2
    { status: 200, body: { active: false } }, // poll 3
    { status: 200, body: { active: false } }, // poll 4
  ]
  const sleeps: number[] = []

  await withMockFetch(responses, requests, async () => {
    const client = new ValuyaPayClient({
      cfg: cfg(),
      backendBaseUrl: "https://backend.example",
      backendToken: "backend-token",
      resource: "whatsapp:bot:test:recipe",
      plan: "standard",
      marketplaceProductId: 47,
      entitlementPollDelaysMs: [10, 20, 35, 60],
      sleepFn: async (ms) => {
        sleeps.push(ms)
      },
    })

    const result = await client.ensurePaid({
      subject: { type: "user", id: "17" },
      orderId: "ord_pending_timeout",
      amountCents: 1,
      currency: "EUR",
      actorType: "agent",
      channel: "whatsapp",
      protocolSubjectHeader: "user:17",
      guardSubjectId: "16",
      linkedWalletAddress: "0x563eFeff9fb7D6FD0243E5b9Cf620690b69058A7",
      cart: [{ sku: "one-cent", name: "One Cent", qty: 1, unit_price_cents: 1 }],
    })

    assert.equal(result.ok, false)
    if (result.ok) return
    assert.equal(result.reason, "pending_settlement")
    assert.equal(result.checkoutUrl, undefined)
    assert.equal(result.topupUrl, undefined)
    assert.deepEqual(sleeps, [10, 20, 35, 60])
  })
})

test("session entitled is treated as immediate success", async () => {
  const requests: Array<{ url: string; init: RequestInit | undefined }> = []
  const responses: MockResponse[] = [
    { status: 200, body: { ok: true } }, // whoami
    { status: 200, body: { ok: true, order: { order_id: "ord_srv_entitled" } } }, // marketplace order
    { status: 200, body: { ok: true, session: { state: "entitled" } } }, // delegated
  ]

  await withMockFetch(responses, requests, async () => {
    const client = new ValuyaPayClient({
      cfg: cfg(),
      backendBaseUrl: "https://backend.example",
      backendToken: "backend-token",
      resource: "whatsapp:bot:test:recipe",
      plan: "standard",
      marketplaceProductId: 47,
      entitlementPollDelaysMs: [0],
    })

    const result = await client.ensurePaid({
      subject: { type: "user", id: "17" },
      orderId: "ord_entitled",
      amountCents: 1,
      currency: "EUR",
      actorType: "agent",
      channel: "whatsapp",
      protocolSubjectHeader: "user:17",
      guardSubjectId: "16",
      linkedWalletAddress: "0x563eFeff9fb7D6FD0243E5b9Cf620690b69058A7",
      cart: [{ sku: "one-cent", name: "One Cent", qty: 1, unit_price_cents: 1 }],
    })

    assert.equal(result.ok, true)
    const entitlementCalls = requests.filter((r) => r.url.includes("/api/v2/entitlements"))
    assert.equal(entitlementCalls.length, 0)
  })
})

test("delegated autopay fails early when marketplace product_id missing", async () => {
  const requests: Array<{ url: string; init: RequestInit | undefined }> = []
  const responses: MockResponse[] = [
    { status: 200, body: { ok: true } }, // whoami
  ]

  await withMockFetch(responses, requests, async () => {
    const client = new ValuyaPayClient({
      cfg: cfg(),
      backendBaseUrl: "https://backend.example",
      backendToken: "backend-token",
      resource: "telegram:bot:test:recipe_confirm",
      plan: "standard",
      marketplaceProductId: 0,
      entitlementPollDelaysMs: [0],
    })

    const result = await client.ensurePaid({
      subject: { type: "user", id: "17" },
      orderId: "ord_4",
      amountCents: 827,
      protocolSubjectHeader: "user:17",
      guardSubjectId: "16",
      linkedWalletAddress: "0x563eFeff9fb7D6FD0243E5b9Cf620690b69058A7",
    })

    assert.equal(result.ok, false)
    if (result.ok) return
    assert.equal(result.checkoutUrl, undefined)
    assert.equal(
      requests.some((r) => r.url.includes("/api/marketplace/orders")),
      false,
    )
    assert.equal(
      requests.some((r) => r.url.includes("/api/agent/orders")),
      false,
    )
  })
})

function cfg(): AgentConfig {
  return {
    base: "https://guard.example",
    tenant_token: "ttok_usage",
  }
}

async function withMockFetch(
  responses: MockResponse[],
  requests: Array<{ url: string; init: RequestInit | undefined }>,
  run: () => Promise<void>,
): Promise<void> {
  const originalFetch = globalThis.fetch
  let callIndex = 0
  globalThis.fetch = async (input: URL | RequestInfo, init?: RequestInit): Promise<Response> => {
    requests.push({ url: String(input), init })
    const response = responses[callIndex++]
    if (!response) {
      throw new Error(`unexpected_fetch_call_${String(input)}`)
    }
    return new Response(JSON.stringify(response.body), {
      status: response.status,
      headers: { "Content-Type": "application/json" },
    })
  }

  try {
    await run()
    assert.equal(callIndex, responses.length)
  } finally {
    globalThis.fetch = originalFetch
  }
}
