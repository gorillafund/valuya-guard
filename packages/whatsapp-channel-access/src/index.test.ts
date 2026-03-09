import test from "node:test"
import assert from "node:assert/strict"
import { WhatsAppChannelAccessService, buildWhatsAppChannelResource } from "./index.js"

test("builds WhatsApp channel resource from provider/channel_identifier/phone", () => {
  const resource = buildWhatsAppChannelResource({
    provider: "meta",
    channelIdentifier: "premium_alpha",
    phoneNumber: "+49123456789",
  })
  assert.equal(resource, "whatsapp:channel:meta:premium_alpha:49123456789")
})

test("unlinked user denied", async () => {
  const service = new WhatsAppChannelAccessService({
    baseUrl: "https://guard.example",
    tenantToken: "ttok_123",
    channelResource: "whatsapp:channel:meta:premium_alpha:49123456789",
    channelPlan: "standard",
    linking: {
      ensureLinkedForPaymentAction: async () => ({
        allowed: false,
        code: "not_linked",
        reply: "Link required",
      }),
    },
  })

  const result = await service.resolveAccess({ whatsappUserId: "49123456789" })
  assert.equal(result.allowed, false)
  if (result.allowed) return
  assert.equal(result.reason, "not_linked")
})

test("linked but inactive entitlement denied", async () => {
  const service = new WhatsAppChannelAccessService({
    baseUrl: "https://guard.example",
    tenantToken: "ttok_123",
    channelResource: "whatsapp:channel:meta:premium_alpha:49123456789",
    channelPlan: "standard",
    linking: {
      ensureLinkedForPaymentAction: async () => ({
        allowed: true,
        link: { valuya_protocol_subject_header: "user:17" },
      }),
    },
  })

  await withMockFetch([{ status: 200, body: { active: false, reason: "inactive" } }], async () => {
    const result = await service.resolveAccess({ whatsappUserId: "49123456789" })
    assert.equal(result.allowed, false)
    if (result.allowed) return
    assert.equal(result.reason, "inactive")
    assert.equal(result.protocolSubjectHeader, "user:17")
  })
})

test("linked and active entitlement allowed with visit URL", async () => {
  const service = new WhatsAppChannelAccessService({
    baseUrl: "https://guard.example",
    tenantToken: "ttok_123",
    channelResource: "whatsapp:channel:meta:premium_alpha:49123456789",
    channelPlan: "standard",
    channelVisitUrl: "https://chat.whatsapp.com/InviteCode",
    linking: {
      ensureLinkedForPaymentAction: async () => ({
        allowed: true,
        link: { valuya_protocol_subject_header: "user:17" },
      }),
    },
  })

  await withMockFetch([{ status: 200, body: { active: true } }], async () => {
    const result = await service.resolveAccess({ whatsappUserId: "49123456789" })
    assert.equal(result.allowed, true)
    if (!result.allowed) return
    assert.equal(result.channelUrl, "https://chat.whatsapp.com/InviteCode")
  })
})

test("entitlement request uses canonical protocol subject header", async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = []
  const service = new WhatsAppChannelAccessService({
    baseUrl: "https://guard.example",
    tenantToken: "ttok_123",
    channelResource: "whatsapp:channel:meta:premium_alpha:49123456789",
    channelPlan: "standard",
    linking: {
      ensureLinkedForPaymentAction: async () => ({
        allowed: true,
        link: { valuya_protocol_subject_header: "user:17" },
      }),
    },
  })

  await withMockFetch(
    [{ status: 200, body: { active: true } }],
    async () => {
      const result = await service.resolveAccess({ whatsappUserId: "49123456789" })
      assert.equal(result.allowed, true)
    },
    (input, init) => {
      calls.push({ url: String(input), init })
    },
  )

  assert.equal(calls.length, 1)
  assert.ok(calls[0].url.includes("/api/v2/entitlements"))
  const headers = new Headers(calls[0].init?.headers)
  assert.equal(headers.get("x-valuya-subject-id"), "user:17")
})

type MockResponse = { status: number; body: unknown }

async function withMockFetch(
  responses: MockResponse[],
  run: () => Promise<void>,
  inspect?: (input: URL | RequestInfo, init?: RequestInit) => void,
): Promise<void> {
  const originalFetch = globalThis.fetch
  let idx = 0
  globalThis.fetch = async (input: URL | RequestInfo, init?: RequestInit): Promise<Response> => {
    inspect?.(input, init)
    const response = responses[idx++]
    if (!response) throw new Error("unexpected_fetch_call")
    return new Response(JSON.stringify(response.body), {
      status: response.status,
      headers: { "Content-Type": "application/json" },
    })
  }

  try {
    await run()
  } finally {
    globalThis.fetch = originalFetch
  }
}
