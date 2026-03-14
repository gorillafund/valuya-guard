import test from "node:test"
import assert from "node:assert/strict"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { readFile, rm } from "node:fs/promises"
import {
  FileSoulMemoryStore,
  SchemaDrivenSoulRuntime,
  WhatsAppBotChannel,
  createMentorSoulDefinition,
} from "./index.js"

const TEST_DIR = path.dirname(fileURLToPath(import.meta.url))
const MEMORY_FILE = path.join(TEST_DIR, "..", ".tmp-memory.json")

test("gated human mode blocks inactive users", async () => {
  const channel = new WhatsAppBotChannel({
    baseUrl: "https://guard.example",
    tenantToken: "ttok_123",
    channelResource: "whatsapp:channel:meta:mentor:49123",
    channelPlan: "standard",
    mode: { kind: "human" },
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
      state: "inactive",
      resource: "whatsapp:channel:meta:mentor:49123",
      anchor_resource: "whatsapp:channel:meta:mentor:49123",
      plan: "standard",
      expires_at: null,
      payment_url: "https://pay.example/checkout/channel",
      reason: "inactive",
      runtime_config: null,
      capabilities: { channel_access_version: "1" },
    },
  }], async () => {
    const result = await channel.handleMessage({
      whatsappUserId: "49123",
      body: "Hallo",
    })

    assert.equal(result.kind, "blocked")
    assert.match(result.reply, /https:\/\/pay\.example\/checkout\/channel/)
  })
})

test("gated human mode allows paid users and returns a handoff reply", async () => {
  const channel = new WhatsAppBotChannel({
    baseUrl: "https://guard.example",
    tenantToken: "ttok_123",
    channelResource: "whatsapp:channel:meta:mentor:49123",
    channelPlan: "standard",
    mode: { kind: "human" },
    humanReply: "Danke. Ein Mensch aus dem Team meldet sich hier im Channel bei dir.",
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
      resource: "whatsapp:channel:meta:mentor:49123",
      anchor_resource: "whatsapp:channel:meta:mentor:49123",
      plan: "standard",
      expires_at: null,
      payment_url: null,
      reason: "mandate_active",
      runtime_config: null,
      capabilities: { channel_access_version: "1" },
    },
  }], async () => {
    const result = await channel.handleMessage({
      whatsappUserId: "49123",
      body: "Hallo",
    })

    assert.equal(result.kind, "human")
    assert.match(result.reply, /Mensch aus dem Team/)
  })
})

test("agent mode uses a configurable response schema and keeps natural mentor memory", async () => {
  const soul = createMentorSoulDefinition()
  const memoryStore = new FileSoulMemoryStore(MEMORY_FILE)
  const soulRuntime = new SchemaDrivenSoulRuntime({
    runCompletion: async () => ({
      mentor_reply: "Es klingt, als wuerdest du viel Verantwortung alleine tragen.",
      deep_question: "Wann hast du zum ersten Mal gelernt, dass du alles selbst tragen musst?",
      follow_up_questions: ["Was vermeidest du, wenn du um Hilfe bittest?"],
      next_step: "Nimm dir heute zehn Minuten und schreib diesen Moment so konkret wie moeglich auf.",
      conversation_summary: "Der Nutzer beschreibt Ueberforderung und starken inneren Druck.",
      user_profile: { focus_area: "stress" },
      root_pattern: "Ich muss alles alleine schaffen",
    }),
  })

  const channel = new WhatsAppBotChannel({
    baseUrl: "https://guard.example",
    tenantToken: "ttok_123",
    channelResource: "whatsapp:channel:meta:mentor:49123",
    channelPlan: "standard",
    mode: { kind: "agent", soulId: "mentor" },
    souls: [soul],
    memoryStore,
    soulRuntime,
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
      resource: "whatsapp:channel:meta:mentor:49123",
      anchor_resource: "whatsapp:channel:meta:mentor:49123",
      plan: "standard",
      expires_at: null,
      payment_url: null,
      reason: "mandate_active",
      runtime_config: null,
      capabilities: { channel_access_version: "1" },
    },
  }], async () => {
    const result = await channel.handleMessage({
      whatsappUserId: "49123",
      body: "Ich fuehle mich seit Wochen ueberfordert.",
    })

    assert.equal(result.kind, "agent")
    assert.match(result.reply, /viel Verantwortung alleine tragen/)
    assert.match(result.reply, /Wann hast du zum ersten Mal gelernt/)
    assert.match(result.reply, /zehn Minuten/)
  })

  const stored = JSON.parse(
    await readFile(MEMORY_FILE, "utf8"),
  ) as Record<string, { summaries?: string[]; userProfile?: Record<string, unknown>; recentTurns?: unknown[] }>
  const entry = stored["49123::mentor"]
  assert.ok(entry)
  assert.ok(Array.isArray(entry.recentTurns))
  assert.match(String(entry.summaries?.[0] || ""), /Ueberforderung/)
  assert.equal(entry.userProfile?.focus_area, "stress")
  assert.deepEqual(entry.userProfile?.recurringPatterns, ["Ich muss alles alleine schaffen"])
  await rm(MEMORY_FILE, { force: true })
})

test("agent mode fails closed when backend runtime says agent but no soul exists", async () => {
  const channel = new WhatsAppBotChannel({
    baseUrl: "https://guard.example",
    tenantToken: "ttok_123",
    channelResource: "whatsapp:channel:meta:mentor:49123",
    channelPlan: "standard",
    mode: { kind: "human" },
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
      resource: "whatsapp:channel:meta:mentor:49123",
      anchor_resource: "whatsapp:channel:meta:mentor:49123",
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
    const result = await channel.handleMessage({
      whatsappUserId: "49123",
      body: "Hallo",
    })

    assert.equal(result.kind, "runtime_error")
    assert.match(result.reply, /Agent|konfiguriert/i)
  })
})

async function withMockFetch(
  responses: Array<{ status: number; body: unknown }>,
  fn: () => Promise<void>,
) {
  const originalFetch = globalThis.fetch
  const queue = [...responses]
  globalThis.fetch = (async () => {
    const next = queue.shift()
    if (!next) throw new Error("unexpected_fetch")
    return new Response(JSON.stringify(next.body), {
      status: next.status,
      headers: { "Content-Type": "application/json" },
    })
  }) as typeof fetch
  try {
    await fn()
  } finally {
    globalThis.fetch = originalFetch
  }
}
