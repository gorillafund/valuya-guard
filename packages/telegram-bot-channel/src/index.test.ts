import test from "node:test"
import assert from "node:assert/strict"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { readFile, rm } from "node:fs/promises"
import {
  FileSoulMemoryStore,
  SchemaDrivenSoulRuntime,
  TelegramBotChannel,
  createMentorSoulDefinition,
} from "./index.js"

const TEST_DIR = path.dirname(fileURLToPath(import.meta.url))
const MEMORY_FILE = path.join(TEST_DIR, "..", ".tmp-memory.json")

test("gated human mode blocks inactive users", async () => {
  const channel = new TelegramBotChannel({
    baseUrl: "https://guard.example",
    tenantToken: "ttok_123",
    channelResource: "telegram:channel:guarddemobot:mentor",
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
      resource: "telegram:channel:guarddemobot:mentor",
      anchor_resource: "telegram:channel:guarddemobot:mentor",
      plan: "standard",
      expires_at: null,
      payment_url: "https://pay.example/checkout/channel",
      reason: "inactive",
      runtime_config: null,
      capabilities: { channel_access_version: "1" },
    },
  }], async () => {
    const result = await channel.handleMessage({
      telegramUserId: "123",
      body: "Hallo",
    })

    assert.equal(result.kind, "blocked")
    assert.match(result.reply, /Payment link/i)
  })
})

test("gated human mode allows paid users and returns a handoff reply", async () => {
  const channel = new TelegramBotChannel({
    baseUrl: "https://guard.example",
    tenantToken: "ttok_123",
    channelResource: "telegram:channel:guarddemobot:mentor",
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
      resource: "telegram:channel:guarddemobot:mentor",
      anchor_resource: "telegram:channel:guarddemobot:mentor",
      plan: "standard",
      expires_at: null,
      payment_url: null,
      reason: "mandate_active",
      runtime_config: null,
      capabilities: { channel_access_version: "1" },
    },
  }], async () => {
    const result = await channel.handleMessage({
      telegramUserId: "123",
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
      mentor_reply: "Es klingt, als wuerdest du sehr viel still mit dir selbst ausmachen.",
      deep_question: "Wem gegenueber musstest du frueher stark wirken?",
      follow_up_questions: ["Was wuerde passieren, wenn du diese Rolle kurz loslaesst?"],
      next_step: "Schreib heute einen Satz auf, den du sonst nur denkst und niemandem sagst.",
      conversation_summary: "Der Nutzer beschreibt inneren Druck und wenig Raum fuer eigene Beduerfnisse.",
      user_profile: { focus_area: "inner_pressure" },
      root_pattern: "Ich darf keine Schwäche zeigen",
    }),
  })

  const channel = new TelegramBotChannel({
    baseUrl: "https://guard.example",
    tenantToken: "ttok_123",
    channelResource: "telegram:channel:guarddemobot:mentor",
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
      resource: "telegram:channel:guarddemobot:mentor",
      anchor_resource: "telegram:channel:guarddemobot:mentor",
      plan: "standard",
      expires_at: null,
      payment_url: null,
      reason: "mandate_active",
      runtime_config: null,
      capabilities: { channel_access_version: "1" },
    },
  }], async () => {
    const result = await channel.handleMessage({
      telegramUserId: "123",
      body: "Ich fuehle mich dauernd unter Druck.",
    })

    assert.equal(result.kind, "agent")
    assert.match(result.reply, /still mit dir selbst ausmachen/)
    assert.match(result.reply, /stark wirken/)
    assert.match(result.reply, /Schreib heute einen Satz/)
  })

  const stored = JSON.parse(
    await readFile(MEMORY_FILE, "utf8"),
  ) as Record<string, { summaries?: string[]; userProfile?: Record<string, unknown>; recentTurns?: unknown[] }>
  const entry = stored["123::mentor"]
  assert.ok(entry)
  assert.ok(Array.isArray(entry.recentTurns))
  assert.equal(entry.userProfile?.focus_area, "inner_pressure")
  assert.deepEqual(entry.userProfile?.recurringPatterns, ["Ich darf keine Schwäche zeigen"])
  await rm(MEMORY_FILE, { force: true })
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
