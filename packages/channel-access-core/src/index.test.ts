import test from "node:test"
import assert from "node:assert/strict"
import {
  InMemoryMemoryStore,
  StaticSoulRuntime,
  appendMemory,
  buildAllowedAccessReply,
  buildRuntimeErrorReply,
} from "./index.js"

test("in-memory store round-trips memory", async () => {
  const store = new InMemoryMemoryStore()
  await store.save({
    userId: "u1",
    soulId: "mentor",
    memory: {
      recentTurns: [{ role: "user", content: "hi", createdAt: "2026-01-01T00:00:00Z" }],
      summaries: [],
      updatedAt: "2026-01-01T00:00:00Z",
    },
  })
  const memory = await store.load({ userId: "u1", soulId: "mentor" })
  assert.equal(memory.recentTurns.length, 1)
})

test("appendMemory appends bounded conversation turns", () => {
  const memory = appendMemory(
    { recentTurns: [], summaries: [], updatedAt: new Date(0).toISOString() },
    "hello",
    "hi back",
  )
  assert.equal(memory.recentTurns.length, 2)
  assert.equal(memory.recentTurns[0]?.role, "user")
  assert.equal(memory.recentTurns[1]?.role, "assistant")
})

test("static soul runtime returns reply", async () => {
  const runtime = new StaticSoulRuntime("Hello")
  const result = await runtime.run()
  assert.equal(result.reply, "Hello")
})

test("reply builders cover english and german", () => {
  assert.match(buildAllowedAccessReply({ state: "paid_active", language: "en" }), /access is active/i)
  assert.match(buildAllowedAccessReply({ state: "paid_active", language: "de" }), /zugang ist aktiv/i)
  assert.match(buildRuntimeErrorReply("runtime_missing", "en"), /no runtime/i)
  assert.match(buildRuntimeErrorReply("runtime_missing", "de"), /keine laufzeit/i)
})
