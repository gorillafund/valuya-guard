import test from "node:test"
import assert from "node:assert/strict"
import {
  createConfiguredSoul,
  createOptionalOpenAISoulRuntime,
  createOptionalWebhookSoulRuntime,
  normalizeChannelMode,
  normalizeSoulProvider,
  parseJsonHeaders,
} from "./index.js"

test("normalizeChannelMode returns agent mode with soul id", () => {
  assert.deepEqual(
    normalizeChannelMode({ value: "agent", soulId: "mentor" }),
    { kind: "agent", soulId: "mentor" },
  )
  assert.deepEqual(
    normalizeChannelMode({ value: "human", soulId: "mentor" }),
    { kind: "human" },
  )
})

test("createConfiguredSoul applies response schema override when valid json is provided", () => {
  const soul = createConfiguredSoul({
    baseSoul: {
      id: "mentor",
      name: "Mentor",
      systemPrompt: "hi",
      responseSchema: undefined as
        | { format: string; replyKey: string }
        | undefined,
    },
    responseSchemaJson: "{\"format\":\"json\",\"replyKey\":\"mentor_reply\"}",
  })

  assert.deepEqual(soul.responseSchema, {
    format: "json",
    replyKey: "mentor_reply",
  })
})

test("createOptionalOpenAISoulRuntime only returns a runtime for agent mode with api key", () => {
  const runtime = createOptionalOpenAISoulRuntime({
    mode: { kind: "agent", soulId: "mentor" },
    apiKey: "sk_test",
    model: "gpt-test",
    createRunner: (args) => args,
    createRuntime: (args) => ({ kind: "runtime", args }),
  })
  assert.deepEqual(runtime, {
    kind: "runtime",
    args: {
      runCompletion: {
        apiKey: "sk_test",
        model: "gpt-test",
      },
    },
  })

  assert.equal(createOptionalOpenAISoulRuntime({
    mode: { kind: "human" },
    apiKey: "sk_test",
    model: "gpt-test",
    createRunner: (args) => args,
    createRuntime: (args) => ({ kind: "runtime", args }),
  }), undefined)
})

test("normalizeSoulProvider maps external runtime aliases onto webhook", () => {
  assert.equal(normalizeSoulProvider("openai"), "openai")
  assert.equal(normalizeSoulProvider("webhook"), "webhook")
  assert.equal(normalizeSoulProvider("n8n"), "webhook")
  assert.equal(normalizeSoulProvider("langchain"), "webhook")
  assert.equal(normalizeSoulProvider("api"), "webhook")
})

test("parseJsonHeaders keeps only simple stringable header values", () => {
  assert.deepEqual(
    parseJsonHeaders("{\"x-flow\":\"mentor\",\"x-debug\":true,\"x-timeout\":30,\"ignore\":{\"deep\":true}}"),
    {
      "x-flow": "mentor",
      "x-debug": "true",
      "x-timeout": "30",
    },
  )
  assert.equal(parseJsonHeaders("{not json"), undefined)
})

test("createOptionalWebhookSoulRuntime forwards provider and extra headers for agent mode", () => {
  const runtime = createOptionalWebhookSoulRuntime({
    mode: { kind: "agent", soulId: "mentor" },
    provider: "n8n",
    url: "https://example.invalid/webhook",
    authToken: "secret",
    timeoutMs: 9000,
    extraHeaders: { "x-flow": "mentor" },
    createRuntime: (args) => ({ kind: "webhook", args }),
  })

  assert.deepEqual(runtime, {
    kind: "webhook",
    args: {
      url: "https://example.invalid/webhook",
      provider: "webhook",
      authToken: "secret",
      timeoutMs: 9000,
      extraHeaders: { "x-flow": "mentor" },
    },
  })
})
