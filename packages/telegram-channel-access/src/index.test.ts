import test from "node:test"
import assert from "node:assert/strict"
import {
  InMemoryMemoryStore,
  StaticSoulRuntime,
  TelegramChannelAccessService,
  TelegramChannelRuntime,
  buildTelegramChannelResource,
} from "./index.js"

test("builds telegram channel resource from bot + channel", () => {
  const resource = buildTelegramChannelResource({
    bot: "guarddemobot",
    channel: "premium_alpha",
  })
  assert.equal(resource, "telegram:channel:guarddemobot:premium_alpha")
})

test("unlinked user denied", async () => {
  const service = new TelegramChannelAccessService({
    baseUrl: "https://guard.example",
    tenantToken: "ttok_usage",
    linking: {
      ensureLinkedForPaymentAction: async () => ({
        allowed: false,
        reply: "Please link first",
        code: "not_linked",
      }),
    },
    channelResource: "telegram:channel:guarddemobot:premium_alpha",
    channelPlan: "standard",
  })

  const result = await service.resolveAccess({ telegramUserId: "123" })
  assert.equal(result.allowed, false)
  if (result.allowed) return
  assert.equal(result.state, "not_linked")
})

test("prefers channel-access resolve for telegram", async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = []
  const service = new TelegramChannelAccessService({
    baseUrl: "https://guard.example",
    tenantToken: "ttok_usage",
    linking: {
      ensureLinkedForPaymentAction: async () => ({
        allowed: true,
        link: { valuya_protocol_subject_header: "user:17" },
      }),
    },
    channelBot: "guarddemobot",
    channelName: "premium_alpha",
    channelPlan: "standard",
    channelInviteUrl: "https://t.me/+premiumInvite",
  })

  await withMockFetch(
    [{
      status: 200,
      body: {
        ok: true,
        state: "paid_active",
        resource: "telegram:channel:guarddemobot:premium_alpha",
        anchor_resource: "telegram:channel:guarddemobot:premium_alpha",
        plan: "standard",
        expires_at: null,
        payment_url: null,
        reason: "mandate_active",
        runtime_config: {
          mode: "human",
          channel: "telegram",
          channel_kind: "channel",
          provider: null,
          channel_app_id: null,
          visit_url: "https://t.me/+premiumInvite",
          human_routing: null,
          agent_routing: null,
          soul: null,
        },
        capabilities: { channel_access_version: "1" },
      },
    }],
    async () => {
      const result = await service.resolveAccess({ telegramUserId: "123" })
      assert.equal(result.allowed, true)
      if (!result.allowed) return
      assert.equal(result.joinUrl, "https://t.me/+premiumInvite")
      assert.equal(result.source, "channel_access_resolve")
      assert.equal(result.runtimeConfig?.channel, "telegram")
    },
    (input, init) => {
      calls.push({ url: String(input), init })
    },
  )

  assert.equal(calls.length, 1)
  assert.ok(calls[0].url.includes("/api/v2/channel-access/resolve"))
  const headers = new Headers(calls[0].init?.headers)
  assert.equal(headers.get("x-valuya-subject-id"), "user:17")
  const body = JSON.parse(String(calls[0].init?.body || "{}"))
  assert.equal(body.channel.kind, "telegram")
  assert.equal(body.channel.bot_name, "guarddemobot")
})

test("falls back to entitlements only when channel-access endpoint is unavailable", async () => {
  const service = new TelegramChannelAccessService({
    baseUrl: "https://guard.example",
    tenantToken: "ttok_usage",
    linking: {
      ensureLinkedForPaymentAction: async () => ({
        allowed: true,
        link: { valuya_protocol_subject_header: "user:17" },
      }),
    },
    channelResource: "telegram:channel:guarddemobot:premium_alpha",
    channelPlan: "standard",
  })

  await withMockFetch(
    [
      { status: 404, body: { ok: false, error: "not_found" } },
      { status: 200, body: { active: true } },
    ],
    async () => {
      const result = await service.resolveAccess({ telegramUserId: "123" })
      assert.equal(result.allowed, true)
      if (!result.allowed) return
      assert.equal(result.source, "entitlements_fallback")
      assert.equal(result.runtimeConfig, null)
    },
  )
})

test("does not fall back on validation failures", async () => {
  const service = new TelegramChannelAccessService({
    baseUrl: "https://guard.example",
    tenantToken: "ttok_usage",
    linking: {
      ensureLinkedForPaymentAction: async () => ({
        allowed: true,
        link: { valuya_protocol_subject_header: "user:17" },
      }),
    },
    channelResource: "telegram:channel:guarddemobot:premium_alpha",
    channelPlan: "standard",
  })

  await withMockFetch([{ status: 422, body: { ok: false, error: "invalid_request" } }], async () => {
    await assert.rejects(
      service.resolveAccess({ telegramUserId: "123" }),
      /telegram_channel_access_resolve_failed:422/,
    )
  })
})

test("allowed access with null runtime_config does not invent runtime", async () => {
  const access = new TelegramChannelAccessService({
    baseUrl: "https://guard.example",
    tenantToken: "ttok_usage",
    linking: {
      ensureLinkedForPaymentAction: async () => ({
        allowed: true,
        link: { valuya_protocol_subject_header: "user:17" },
      }),
    },
    channelResource: "telegram:channel:guarddemobot:premium_alpha",
    channelPlan: "standard",
    channelInviteUrl: "https://t.me/+premiumInvite",
  })

  await withMockFetch([{
    status: 200,
    body: {
      ok: true,
      state: "trial_active",
      resource: "telegram:channel:guarddemobot:premium_alpha",
      anchor_resource: "telegram:channel:guarddemobot:premium_alpha",
      plan: "standard",
      expires_at: "2026-03-31T23:59:59Z",
      payment_url: null,
      reason: "trial_active",
      runtime_config: null,
      capabilities: { channel_access_version: "1" },
    },
  }], async () => {
    const runtime = new TelegramChannelRuntime({
      access,
      memoryStore: new InMemoryMemoryStore(),
    })
    const result = await runtime.handleMessage({
      telegramUserId: "123",
      body: "Hallo",
    })
    assert.equal(result.kind, "allowed")
    assert.match(result.reply, /valid until/i)
  })
})

test("runtime uses backend human mode when configured", async () => {
  const access = new TelegramChannelAccessService({
    baseUrl: "https://guard.example",
    tenantToken: "ttok_usage",
    linking: {
      ensureLinkedForPaymentAction: async () => ({
        allowed: true,
        link: { valuya_protocol_subject_header: "user:17" },
      }),
    },
    channelResource: "telegram:channel:guarddemobot:premium_alpha",
    channelPlan: "standard",
    channelInviteUrl: "https://t.me/+premiumInvite",
  })

  await withMockFetch([{
    status: 200,
    body: {
      ok: true,
      state: "paid_active",
      resource: "telegram:channel:guarddemobot:premium_alpha",
      anchor_resource: "telegram:channel:guarddemobot:premium_alpha",
      plan: "standard",
      expires_at: null,
      payment_url: null,
      reason: "mandate_active",
      runtime_config: {
        mode: "human",
        channel: "telegram",
        channel_kind: "channel",
        provider: null,
        channel_app_id: null,
        visit_url: "https://t.me/+premiumInvite",
        human_routing: null,
        agent_routing: null,
        soul: null,
      },
      capabilities: { channel_access_version: "1" },
    },
  }], async () => {
    const runtime = new TelegramChannelRuntime({
      access,
      memoryStore: new InMemoryMemoryStore(),
    })
    const result = await runtime.handleMessage({
      telegramUserId: "123",
      body: "Hallo",
    })
    assert.equal(result.kind, "human")
  })
})

test("runtime uses backend agent mode when configured", async () => {
  const access = new TelegramChannelAccessService({
    baseUrl: "https://guard.example",
    tenantToken: "ttok_usage",
    linking: {
      ensureLinkedForPaymentAction: async () => ({
        allowed: true,
        link: { valuya_protocol_subject_header: "user:17" },
      }),
    },
    channelResource: "telegram:channel:guarddemobot:premium_alpha",
    channelPlan: "standard",
  })

  await withMockFetch([{
    status: 200,
    body: {
      ok: true,
      state: "paid_active",
      resource: "telegram:channel:guarddemobot:premium_alpha",
      anchor_resource: "telegram:channel:guarddemobot:premium_alpha",
      plan: "standard",
      expires_at: null,
      payment_url: null,
      reason: "mandate_active",
      runtime_config: {
        mode: "agent",
        channel: "telegram",
        channel_kind: "channel",
        provider: null,
        channel_app_id: null,
        visit_url: null,
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
    const runtime = new TelegramChannelRuntime({
      access,
      memoryStore,
      soulRuntime: new StaticSoulRuntime("What is most alive in this for you right now?"),
      souls: [
        {
          id: "mentor",
          name: "Mentor",
          systemPrompt: "You are a reflective mentor.",
        },
      ],
    })
    const result = await runtime.handleMessage({
      telegramUserId: "123",
      body: "I feel stuck.",
    })
    assert.equal(result.kind, "agent")
    assert.equal(result.soulId, "mentor")
  })
})

test("agent mode with missing backend soul returns runtime error", async () => {
  const access = new TelegramChannelAccessService({
    baseUrl: "https://guard.example",
    tenantToken: "ttok_usage",
    linking: {
      ensureLinkedForPaymentAction: async () => ({
        allowed: true,
        link: { valuya_protocol_subject_header: "user:17" },
      }),
    },
    channelResource: "telegram:channel:guarddemobot:premium_alpha",
    channelPlan: "standard",
  })

  await withMockFetch([{
    status: 200,
    body: {
      ok: true,
      state: "paid_active",
      resource: "telegram:channel:guarddemobot:premium_alpha",
      anchor_resource: "telegram:channel:guarddemobot:premium_alpha",
      plan: "standard",
      expires_at: null,
      payment_url: null,
      reason: "mandate_active",
      runtime_config: {
        mode: "agent",
        channel: "telegram",
        channel_kind: "channel",
        provider: null,
        channel_app_id: null,
        visit_url: null,
        human_routing: null,
        agent_routing: { entrypoint: "channel-runtime" },
        soul: null,
      },
      capabilities: { channel_access_version: "1" },
    },
  }], async () => {
    const runtime = new TelegramChannelRuntime({
      access,
      memoryStore: new InMemoryMemoryStore(),
    })
    const result = await runtime.handleMessage({
      telegramUserId: "123",
      body: "Hi",
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
  let index = 0
  globalThis.fetch = async (input: URL | RequestInfo, init?: RequestInit): Promise<Response> => {
    inspect?.(input, init)
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
