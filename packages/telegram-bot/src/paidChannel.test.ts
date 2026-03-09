import test from "node:test"
import assert from "node:assert/strict"
import { TelegramPaidChannelAccessService, buildTelegramChannelResource } from "./paidChannel.js"

test("builds telegram channel resource from bot + channel", () => {
  const resource = buildTelegramChannelResource({
    bot: "guarddemobot",
    channel: "premium_alpha",
  })
  assert.equal(resource, "telegram:channel:guarddemobot:premium_alpha")
})

test("unlinked user denied", async () => {
  const service = new TelegramPaidChannelAccessService({
    baseUrl: "https://guard.example",
    tenantToken: "ttok_usage",
    linking: {
      ensureLinkedForPaymentAction: async () => ({
        allowed: false,
        reply: "Please link first",
        code: "not_linked",
      }),
    } as any,
    channelResource: "telegram:channel:guarddemobot:premium_alpha",
    channelPlan: "standard",
  })

  const result = await service.resolveAccess({ telegramUserId: "123" })
  assert.equal(result.allowed, false)
  if (result.allowed) return
  assert.equal(result.reason, "not_linked")
})

test("linked but inactive entitlement denied", async () => {
  const service = new TelegramPaidChannelAccessService({
    baseUrl: "https://guard.example",
    tenantToken: "ttok_usage",
    linking: {
      ensureLinkedForPaymentAction: async () => ({
        allowed: true,
        subject: { type: "user", externalId: "17" },
        link: {
          valuya_protocol_subject_header: "user:17",
        },
      }),
    } as any,
    channelResource: "telegram:channel:guarddemobot:premium_alpha",
    channelPlan: "standard",
  })

  await withMockFetch([{ status: 200, body: { active: false, reason: "inactive" } }], async () => {
    const result = await service.resolveAccess({ telegramUserId: "123" })
    assert.equal(result.allowed, false)
    if (result.allowed) return
    assert.equal(result.reason, "inactive")
    assert.equal(result.protocolSubjectHeader, "user:17")
  })
})

test("linked and active entitlement allowed with configured invite URL", async () => {
  const service = new TelegramPaidChannelAccessService({
    baseUrl: "https://guard.example",
    tenantToken: "ttok_usage",
    linking: {
      ensureLinkedForPaymentAction: async () => ({
        allowed: true,
        subject: { type: "user", externalId: "17" },
        link: {
          valuya_protocol_subject_header: "user:17",
        },
      }),
    } as any,
    channelResource: "telegram:channel:guarddemobot:premium_alpha",
    channelPlan: "standard",
    channelInviteUrl: "https://t.me/+premiumInvite",
  })

  await withMockFetch([{ status: 200, body: { active: true } }], async () => {
    const result = await service.resolveAccess({ telegramUserId: "123" })
    assert.equal(result.allowed, true)
    if (!result.allowed) return
    assert.equal(result.joinUrl, "https://t.me/+premiumInvite")
    assert.equal(result.resource, "telegram:channel:guarddemobot:premium_alpha")
    assert.equal(result.plan, "standard")
  })
})

test("entitlement request uses canonical protocol subject header", async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = []
  const service = new TelegramPaidChannelAccessService({
    baseUrl: "https://guard.example",
    tenantToken: "ttok_usage",
    linking: {
      ensureLinkedForPaymentAction: async () => ({
        allowed: true,
        subject: { type: "user", externalId: "17" },
        link: {
          valuya_protocol_subject_header: "user:17",
        },
      }),
    } as any,
    channelResource: "telegram:channel:guarddemobot:premium_alpha",
    channelPlan: "standard",
  })

  await withMockFetch(
    [{ status: 200, body: { active: true } }],
    async (input, init) => {
      calls.push({ url: String(input), init })
      return undefined
    },
    async () => {
      const result = await service.resolveAccess({ telegramUserId: "123" })
      assert.equal(result.allowed, true)
    },
  )

  assert.equal(calls.length, 1)
  const req = calls[0]
  assert.ok(req.url.includes("/api/v2/entitlements"))
  assert.ok(req.url.includes("resource=telegram%3Achannel%3Aguarddemobot%3Apremium_alpha"))
  const headers = new Headers(req.init?.headers)
  assert.equal(headers.get("x-valuya-subject-id"), "user:17")
})

type MockResponse = { status: number; body: unknown }

async function withMockFetch(
  responses: MockResponse[],
  inspectOrRun: ((input: URL | RequestInfo, init?: RequestInit) => Promise<Response | undefined> | Response | undefined) | (() => Promise<void>),
  maybeRun?: () => Promise<void>,
): Promise<void> {
  const originalFetch = globalThis.fetch
  let index = 0
  const inspect =
    typeof maybeRun === "function"
      ? (inspectOrRun as (input: URL | RequestInfo, init?: RequestInit) => Promise<Response | undefined> | Response | undefined)
      : undefined
  const run = (typeof maybeRun === "function" ? maybeRun : (inspectOrRun as () => Promise<void>))

  globalThis.fetch = async (input: URL | RequestInfo, init?: RequestInit): Promise<Response> => {
    if (inspect) {
      const inspected = await inspect(input, init)
      if (inspected) return inspected
    }
    const next = responses[index++]
    if (!next) throw new Error("unexpected_fetch_call")
    return new Response(JSON.stringify(next.body), {
      status: next.status,
      headers: { "Content-Type": "application/json" },
    })
  }

  try {
    await run()
  } finally {
    globalThis.fetch = originalFetch
  }
}
