import test from "node:test"
import assert from "node:assert/strict"
import { BackendAlfiesCheckoutAdapter } from "./BackendAlfiesCheckoutAdapter.js"

test("adapter falls back to legacy /api/agent/orders when submit-paid route is missing", async () => {
  const calls: Array<{ url: string; body: Record<string, unknown> }> = []
  const fetchImpl: typeof fetch = (async (input: string | URL, init?: RequestInit) => {
    const url = String(input)
    const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : {}
    calls.push({ url, body })

    if (url.endsWith("/api/agent/orders/submit-paid")) {
      return new Response(JSON.stringify({
        ok: false,
        error: "not_found",
        message: "The route api/agent/orders/submit-paid could not be found.",
      }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      })
    }

    if (url.endsWith("/api/agent/orders")) {
      return new Response(JSON.stringify({
        ok: true,
        order_id: "alfies_legacy_1",
        status: "submitted",
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    }

    throw new Error(`unexpected_url:${url}`)
  }) as typeof fetch

  const adapter = new BackendAlfiesCheckoutAdapter({
    baseUrl: "https://backend.example",
    token: "tt_test",
    resource: "whatsapp:bot:test",
    plan: "standard",
    source: "whatsapp",
    fetchImpl,
  })

  const result = await adapter.submitPaidOrder({
    localOrderId: "ord_1",
    protocolSubjectHeader: "app_user:1",
    paymentReference: "guard_order_1",
    lines: [
      { sku: "alfies-1", name: "Milch", qty: 2, unitPriceCents: 219 },
    ],
    deliveryAddress: {
      line1: "Praterstrasse",
      house: "12A",
      postcode: "1020",
      city: "Wien",
      latitude: 48.214,
      longitude: 16.385,
    },
    shippingOption: {
      code: "express_1800_1900",
      date: "2026-03-14",
      name: "18:00 - 19:00",
    },
    expectedTotalCents: 438,
  })

  assert.equal(calls.length, 2)
  assert.match(calls[0]?.url || "", /\/api\/agent\/orders\/submit-paid$/)
  assert.match(calls[1]?.url || "", /\/api\/agent\/orders$/)
  assert.equal(calls[1]?.body?.order_id, "ord_1")
  assert.equal(calls[1]?.body?.resource, "whatsapp:bot:test")
  assert.equal(calls[1]?.body?.plan, "standard")
  assert.equal(result.externalOrderId, "alfies_legacy_1")
})
