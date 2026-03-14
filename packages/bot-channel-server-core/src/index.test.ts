import test from "node:test"
import assert from "node:assert/strict"
import {
  createOpenAIResponsesRunner,
  getRequestPath,
  handleInternalJsonMessage,
  resolveRequestUrl,
  tryParseJson,
} from "./index.js"

test("getRequestPath normalizes malformed or empty urls", () => {
  assert.equal(getRequestPath(undefined), "/")
  assert.equal(getRequestPath("/internal/message?x=1"), "/internal/message")
})

test("resolveRequestUrl respects forwarded headers", () => {
  const url = resolveRequestUrl({
    headers: {
      "x-forwarded-proto": "https",
      "x-forwarded-host": "example.com",
    },
    url: "/hook",
  })
  assert.equal(url, "https://example.com/hook")
})

test("handleInternalJsonMessage enforces internal token and returns json response", async () => {
  const req = jsonBodyStream({ body: "hello" })
  const unauthorized = await handleInternalJsonMessage({
    req,
    internalApiToken: "secret",
    providedToken: "wrong",
    onMessage: async () => ({ reply: "ok" }),
  })
  assert.equal(unauthorized.status, 401)

  const authorized = await handleInternalJsonMessage({
    req: jsonBodyStream({ body: "hello" }),
    internalApiToken: "secret",
    providedToken: "secret",
    onMessage: async (body) => ({
      reply: String(body.body || ""),
      metadata: { seen: true },
    }),
  })
  assert.equal(authorized.status, 200)
  assert.match(authorized.body, /"reply":"hello"/)
})

test("createOpenAIResponsesRunner normalizes output_text json", async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = (async () => new Response(JSON.stringify({
    output_text: "{\"mentor_reply\":\"Hallo\"}",
  }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  })) as typeof fetch

  try {
    const runner = createOpenAIResponsesRunner({
      apiKey: "sk_test",
      model: "gpt-test",
    })
    const result = await runner({ system: "s", user: "u" })
    assert.deepEqual(result, { mentor_reply: "Hallo" })
    assert.deepEqual(tryParseJson("{\"ok\":true}"), { ok: true })
  } finally {
    globalThis.fetch = originalFetch
  }
})

function jsonBodyStream(value: Record<string, unknown>): AsyncIterable<Uint8Array> {
  const payload = Buffer.from(JSON.stringify(value), "utf8")
  return {
    async *[Symbol.asyncIterator]() {
      yield payload
    },
  }
}
