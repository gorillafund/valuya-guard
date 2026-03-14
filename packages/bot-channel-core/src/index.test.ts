import test from "node:test"
import assert from "node:assert/strict"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { readFile, rm } from "node:fs/promises"
import {
  FileSoulMemoryStore,
  SchemaDrivenSoulRuntime,
  WebhookSoulRuntime,
  createConciergeSoulDefinition,
  createMentorSoulDefinition,
  createSupportSoulDefinition,
} from "./index.js"

const TEST_DIR = path.dirname(fileURLToPath(import.meta.url))
const MEMORY_FILE = path.join(TEST_DIR, "..", ".tmp-memory.json")

test("schema runtime composes a natural reply from structured payload", async () => {
  const soul = createMentorSoulDefinition()
  const runtime = new SchemaDrivenSoulRuntime({
    runCompletion: async () => ({
      mentor_reply: "Du klingst gerade sehr angespannt.",
      deep_question: "Seit wann traegst du diesen Druck mit dir herum?",
      next_step: "Nimm dir heute zwei Minuten und benenne den Druck ohne ihn zu bewerten.",
    }),
  })

  const result = await runtime.run({
    soul,
    message: "Ich bin sehr gestresst.",
    memory: {
      recentTurns: [],
      summaries: [],
      updatedAt: new Date(0).toISOString(),
    },
    protocolSubjectHeader: "user:17",
    locale: "de",
  })

  assert.match(result.reply, /sehr angespannt/)
  assert.match(result.reply, /Seit wann/)
  assert.match(result.reply, /zwei Minuten/)
})

test("file memory store accepts channel-specific user ids", async () => {
  const store = new FileSoulMemoryStore(MEMORY_FILE)
  await store.save({
    whatsappUserId: "49123",
    soulId: "mentor",
    memory: {
      recentTurns: [],
      summaries: ["Stress"],
      updatedAt: new Date(0).toISOString(),
    },
  })

  const value = await store.load({
    userId: "49123",
    soulId: "mentor",
  })
  assert.deepEqual(value.summaries, ["Stress"])

  const raw = JSON.parse(await readFile(MEMORY_FILE, "utf8")) as Record<string, unknown>
  assert.ok(raw["49123::mentor"])
  await rm(MEMORY_FILE, { force: true })
})

test("support and concierge presets expose task-specific reply schemas", () => {
  const support = createSupportSoulDefinition()
  const concierge = createConciergeSoulDefinition()

  assert.equal(support.id, "support")
  assert.equal(support.responseSchema?.replyKey, "support_reply")
  assert.equal(support.responseSchema?.followUpQuestionKey, "clarifying_question")

  assert.equal(concierge.id, "concierge")
  assert.equal(concierge.responseSchema?.replyKey, "concierge_reply")
  assert.equal(concierge.responseSchema?.nextStepKey, "recommended_next_step")
})

test("webhook runtime accepts structured webhook replies and merges memory", async () => {
  const originalFetch = globalThis.fetch
  let capturedRequest: {
    headers: Headers
    body: Record<string, unknown>
  } = {
    headers: new Headers(),
    body: {},
  }

  globalThis.fetch = (async (input, init) => {
    capturedRequest = {
      headers: new Headers(init?.headers),
      body: JSON.parse(String(init?.body || "{}")) as Record<string, unknown>,
    }
    return new Response(JSON.stringify({
      mentor_reply: "Du klingst, als waere da viel Druck.",
      deep_question: "Wann hat sich das zum ersten Mal so angefuehlt?",
      conversation_summary: "Der Nutzer berichtet von Druck.",
      user_profile: { focus_area: "stress" },
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    })
  }) as typeof fetch

  try {
    const runtime = new WebhookSoulRuntime({
      url: "https://example.invalid/runtime",
      provider: "n8n",
      authToken: "secret",
      extraHeaders: { "x-flow-id": "mentor-1" },
    })
    const result = await runtime.run({
      soul: createMentorSoulDefinition(),
      message: "Ich stehe unter Druck.",
      memory: {
        recentTurns: [],
        summaries: [],
        updatedAt: new Date(0).toISOString(),
      },
      protocolSubjectHeader: "user:17",
      locale: "de",
    })

    assert.match(result.reply, /viel Druck/)
    assert.match(result.reply, /zum ersten Mal/)
    assert.match(String(result.memory?.summaries?.[0] || ""), /Druck/)
    const request = capturedRequest
    assert.equal(request.headers.get("authorization"), "Bearer secret")
    assert.equal(request.headers.get("x-flow-id"), "mentor-1")
    assert.equal(request.body.version, "1")
    assert.equal(request.body.provider, "n8n")
    assert.equal((request.body.context as Record<string, unknown>)?.protocolSubjectHeader, "user:17")
    assert.equal((((request.body.soul as Record<string, unknown>)?.responseSchema) as Record<string, unknown>)?.replyKey, "mentor_reply")
  } finally {
    globalThis.fetch = originalFetch
  }
})
