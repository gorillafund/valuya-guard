import test from "node:test"
import assert from "node:assert/strict"
import {
  GuardChannelMandateResolver,
  InMemoryMemoryStore,
  WhatsAppChannelAccessService,
  WhatsAppChannelRuntime,
  buildWhatsAppChannelResource,
} from "./index.js"
import { StaticSoulRuntime } from "./testing/StaticSoulRuntime.js"

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
  assert.equal(result.state, "not_linked")
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
    assert.equal(result.state, "inactive")
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

  await withMockFetch([{
    status: 200,
    body: {
      ok: true,
      state: "paid_active",
      resource: "whatsapp:channel:meta:premium_alpha:49123456789",
      anchor_resource: "whatsapp:channel:meta:premium_alpha:49123456789",
      plan: "standard",
      expires_at: null,
      payment_url: null,
      reason: "mandate_active",
      runtime_config: null,
      capabilities: { channel_access_version: "1" },
    },
  }], async () => {
    const result = await service.resolveAccess({ whatsappUserId: "49123456789" })
    assert.equal(result.allowed, true)
    if (!result.allowed) return
    assert.equal(result.channelUrl, "https://chat.whatsapp.com/InviteCode")
  })
})

test("channel-access resolve request uses canonical protocol subject header", async () => {
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
    [{
      status: 200,
      body: {
        ok: true,
        state: "paid_active",
        resource: "whatsapp:channel:meta:premium_alpha:49123456789",
        anchor_resource: "whatsapp:channel:meta:premium_alpha:49123456789",
        plan: "standard",
        expires_at: null,
        payment_url: null,
        reason: "mandate_active",
        runtime_config: null,
        capabilities: { channel_access_version: "1" },
      },
    }],
    async () => {
      const result = await service.resolveAccess({ whatsappUserId: "49123456789" })
      assert.equal(result.allowed, true)
    },
    (input, init) => {
      calls.push({ url: String(input), init })
    },
  )

  assert.equal(calls.length, 1)
  assert.ok(calls[0].url.includes("/api/v2/channel-access/resolve"))
  const headers = new Headers(calls[0].init?.headers)
  assert.equal(headers.get("x-valuya-subject-id"), "user:17")
})

test("prefers channel-access resolve and sends canonical body", async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = []
  const service = new WhatsAppChannelAccessService({
    baseUrl: "https://guard.example",
    tenantToken: "ttok_123",
    channelProvider: "meta",
    channelIdentifier: "premium_alpha",
    channelPhoneNumber: "+49123456789",
    linking: {
      ensureLinkedForPaymentAction: async () => ({
        allowed: true,
        link: { valuya_protocol_subject_header: "user:17" },
      }),
    },
  })

  await withMockFetch(
    [{
      status: 200,
      body: {
        ok: true,
        state: "paid_active",
        resource: "whatsapp:channel:meta:premium_alpha:49123456789",
        anchor_resource: "whatsapp:channel:meta:premium_alpha:49123456789",
        plan: "standard",
        expires_at: null,
        payment_url: null,
        reason: "mandate_active",
        runtime_config: null,
        capabilities: { channel_access_version: "1" },
      },
    }],
    async () => {
      const result = await service.resolveAccess({ whatsappUserId: "49123456789" })
      assert.equal(result.allowed, true)
      if (!result.allowed) return
      assert.equal(result.source, "channel_access_resolve")
      assert.equal(result.capabilities?.channel_access_version, "1")
    },
    (input, init) => {
      calls.push({ url: String(input), init })
    },
  )

  assert.equal(calls.length, 1)
  assert.ok(calls[0].url.includes("/api/v2/channel-access/resolve"))
  const body = JSON.parse(String(calls[0].init?.body || "{}"))
  assert.equal(body.resource, "whatsapp:channel:meta:premium_alpha:49123456789")
  assert.equal(body.channel.kind, "whatsapp")
  assert.equal(body.channel.provider, "meta")
  assert.equal(body.channel.phone_number, "49123456789")
})

test("falls back to entitlements only for route-missing channel-access endpoint", async () => {
  const service = new WhatsAppChannelAccessService({
    baseUrl: "https://guard.example",
    tenantToken: "ttok_123",
    channelResource: "whatsapp:channel:meta:premium_alpha:49123456789",
    linking: {
      ensureLinkedForPaymentAction: async () => ({
        allowed: true,
        link: { valuya_protocol_subject_header: "user:17" },
      }),
    },
  })

  await withMockFetch(
    [
      { status: 404, body: { ok: false, error: "not_found" } },
      { status: 200, body: { active: true } },
    ],
    async () => {
      const result = await service.resolveAccess({ whatsappUserId: "49123456789" })
      assert.equal(result.allowed, true)
      if (!result.allowed) return
      assert.equal(result.source, "entitlements_fallback")
    },
  )
})

test("does not fall back on validation/auth-style failures", async () => {
  const resolver = new GuardChannelMandateResolver({
    baseUrl: "https://guard.example",
    tenantToken: "ttok_123",
  })

  await withMockFetch([{ status: 422, body: { ok: false, error: "invalid_request" } }], async () => {
    await assert.rejects(
      resolver.resolve({
        protocolSubjectHeader: "user:17",
        resource: "whatsapp:channel:meta:premium_alpha:49123456789",
        plan: "standard",
      }),
      /mandate_resolve_failed:422/,
    )
  })
})

test("trial-active access is allowed and keeps expiration", async () => {
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
    [{ status: 200, body: { state: "trial_active", expires_at: "2026-03-31T23:59:59Z" } }],
    async () => {
      const result = await service.resolveAccess({ whatsappUserId: "49123456789" })
      assert.equal(result.allowed, true)
      if (!result.allowed) return
      assert.equal(result.state, "trial_active")
      assert.equal(result.expiresAt, "2026-03-31T23:59:59Z")
    },
  )
})

test("expired trial returns payment-required decision", async () => {
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
    [{
      status: 200,
      body: {
        state: "expired_payment_required",
        expires_at: "2026-03-01T00:00:00Z",
        payment_url: "https://pay.example/checkout/ch_123",
      },
    }],
    async () => {
      const result = await service.resolveAccess({ whatsappUserId: "49123456789" })
      assert.equal(result.allowed, false)
      if (result.allowed) return
      assert.equal(result.state, "expired_payment_required")
      assert.equal(result.paymentUrl, "https://pay.example/checkout/ch_123")
      assert.equal(result.expiresAt, "2026-03-01T00:00:00Z")
    },
  )
})

test("runtime routes active users to human handoff", async () => {
  const access = new WhatsAppChannelAccessService({
    baseUrl: "https://guard.example",
    tenantToken: "ttok_123",
    channelResource: "whatsapp:channel:meta:premium_alpha:49123456789",
    linking: {
      ensureLinkedForPaymentAction: async () => ({
        allowed: true,
        link: { valuya_protocol_subject_header: "user:17" },
      }),
    },
  })

  await withMockFetch([{
    status: 200,
    body: {
      ok: true,
      state: "paid_active",
      resource: "whatsapp:channel:meta:premium_alpha:49123456789",
      anchor_resource: "whatsapp:channel:meta:premium_alpha:49123456789",
      plan: "standard",
      expires_at: null,
      payment_url: null,
      reason: "mandate_active",
      runtime_config: {
        mode: "human",
        channel: "whatsapp",
        channel_kind: "channel",
        provider: "meta",
        channel_app_id: "whatsapp_main",
        visit_url: "https://wa.me/49123456789",
        human_routing: null,
        agent_routing: null,
        soul: null,
      },
      capabilities: { channel_access_version: "1" },
    },
  }], async () => {
    const runtime = new WhatsAppChannelRuntime({
      access,
      memoryStore: new InMemoryMemoryStore(),
    })
    const result = await runtime.handleMessage({
      whatsappUserId: "49123456789",
      body: "Hallo",
    })
    assert.equal(result.kind, "human")
    assert.match(result.reply, /menschlichen kanal/i)
  })
})

test("runtime routes active users to configured soul and persists memory", async () => {
  const access = new WhatsAppChannelAccessService({
    baseUrl: "https://guard.example",
    tenantToken: "ttok_123",
    channelResource: "whatsapp:channel:meta:premium_alpha:49123456789",
    linking: {
      ensureLinkedForPaymentAction: async () => ({
        allowed: true,
        link: { valuya_protocol_subject_header: "user:17" },
      }),
    },
  })

  await withMockFetch([{
    status: 200,
    body: {
      ok: true,
      state: "paid_active",
      resource: "whatsapp:channel:meta:premium_alpha:49123456789",
      anchor_resource: "whatsapp:channel:meta:premium_alpha:49123456789",
      plan: "standard",
      expires_at: null,
      payment_url: null,
      reason: "mandate_active",
      runtime_config: {
        mode: "agent",
        channel: "whatsapp",
        channel_kind: "channel",
        provider: "meta",
        channel_app_id: "whatsapp_main",
        visit_url: "https://wa.me/49123456789",
        human_routing: null,
        agent_routing: { entrypoint: "channel-runtime" },
        soul: {
          id: 3,
          slug: "mentor",
          name: "Mentor",
          version: 2,
        },
      },
      capabilities: { channel_access_version: "1" },
    },
  }], async () => {
    const memoryStore = new InMemoryMemoryStore()
    const runtime = new WhatsAppChannelRuntime({
      access,
      memoryStore,
      soulRuntime: new StaticSoulRuntime("Was beschaeftigt dich daran gerade am meisten?"),
      souls: [
        {
          id: "mentor",
          name: "Mentor",
          systemPrompt: "Du bist ein hilfreicher Mentor.",
        },
      ],
    })

    const result = await runtime.handleMessage({
      whatsappUserId: "49123456789",
      body: "Ich fuehle mich festgefahren.",
      locale: "de",
    })

    assert.equal(result.kind, "agent")
    assert.equal(result.soulId, "mentor")
    assert.match(result.reply, /am meisten/i)

    const memory = await memoryStore.load({
      whatsappUserId: "49123456789",
      soulId: "mentor",
    })
    assert.equal(memory.recentTurns.length, 2)
    assert.equal(memory.recentTurns[0]?.role, "user")
    assert.equal(memory.recentTurns[1]?.role, "assistant")
  })
})

test("allowed access with null runtime_config does not invent a runtime", async () => {
  const access = new WhatsAppChannelAccessService({
    baseUrl: "https://guard.example",
    tenantToken: "ttok_123",
    channelVisitUrl: "https://chat.whatsapp.com/InviteCode",
    channelResource: "whatsapp:channel:meta:premium_alpha:49123456789",
    linking: {
      ensureLinkedForPaymentAction: async () => ({
        allowed: true,
        link: { valuya_protocol_subject_header: "user:17" },
      }),
    },
  })

  await withMockFetch([{
    status: 200,
    body: {
      ok: true,
      state: "trial_active",
      resource: "whatsapp:channel:meta:premium_alpha:49123456789",
      anchor_resource: "whatsapp:channel:meta:premium_alpha:49123456789",
      plan: "standard",
      expires_at: "2026-03-31T23:59:59Z",
      payment_url: null,
      reason: "trial_active",
      runtime_config: null,
      capabilities: { channel_access_version: "1" },
    },
  }], async () => {
    const runtime = new WhatsAppChannelRuntime({
      access,
      memoryStore: new InMemoryMemoryStore(),
    })
    const result = await runtime.handleMessage({
      whatsappUserId: "49123456789",
      body: "Hallo",
    })
    assert.equal(result.kind, "allowed")
    assert.match(result.reply, /gueltig bis/i)
  })
})

test("agent mode with missing backend soul returns runtime error", async () => {
  const access = new WhatsAppChannelAccessService({
    baseUrl: "https://guard.example",
    tenantToken: "ttok_123",
    channelResource: "whatsapp:channel:meta:premium_alpha:49123456789",
    linking: {
      ensureLinkedForPaymentAction: async () => ({
        allowed: true,
        link: { valuya_protocol_subject_header: "user:17" },
      }),
    },
  })

  await withMockFetch([{
    status: 200,
    body: {
      ok: true,
      state: "paid_active",
      resource: "whatsapp:channel:meta:premium_alpha:49123456789",
      anchor_resource: "whatsapp:channel:meta:premium_alpha:49123456789",
      plan: "standard",
      expires_at: null,
      payment_url: null,
      reason: "mandate_active",
      runtime_config: {
        mode: "agent",
        channel: "whatsapp",
        channel_kind: "channel",
        provider: "meta",
        channel_app_id: "whatsapp_main",
        visit_url: null,
        human_routing: null,
        agent_routing: { entrypoint: "channel-runtime" },
        soul: null,
      },
      capabilities: { channel_access_version: "1" },
    },
  }], async () => {
    const runtime = new WhatsAppChannelRuntime({
      access,
      memoryStore: new InMemoryMemoryStore(),
    })
    const result = await runtime.handleMessage({
      whatsappUserId: "49123456789",
      body: "Hallo",
    })
    assert.equal(result.kind, "runtime_error")
    assert.equal(result.error, "agent_misconfigured")
  })
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
