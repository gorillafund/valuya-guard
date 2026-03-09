import test from "node:test"
import assert from "node:assert/strict"
import { OpenAIIntentClient, fallbackCatalogQuery, fallbackIntent } from "./openaiIntent.js"

test("fallback intent routes basic recipe requests", () => {
  const intent = fallbackIntent("I want a vegetarian pasta for 2")
  assert.equal(intent.intent, "recipe_request")
})

test("fallback intent detects preference updates", () => {
  const intent = fallbackIntent("I prefer bio and regional products")
  assert.equal(intent.intent, "preferences_update")
})

test("fallback catalog query normalizes loose packaging language", () => {
  const query = fallbackCatalogQuery("kiste bier fuer heute abend")
  assert.match(query.normalizedQuery, /kiste bier/)
  assert.ok(query.normalizedTerms.includes("beer"))
  assert.equal(query.packagingHint, "crate")
})

test("openai intent client parses strict json response", async () => {
  const fetchImpl: typeof fetch = async () =>
    new Response(
      JSON.stringify({
        output_text: JSON.stringify({
          intent: "recipe_request",
          confidence: 0.91,
          replyMode: "clarify",
          missingSlots: ["deliveryDate"],
          extracted: { servings: 2, dietary: ["vegetarian"], productQuery: "pasta" },
          assistantMessage: "Which day should I target?",
        }),
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    )

  const client = new OpenAIIntentClient({
    apiKey: "test-key",
    fetchImpl,
  })
  const result = await client.interpret({
    message: "vegetarian pasta for two",
    contextSummary: "existing basket empty",
  })

  assert.equal(result.intent, "recipe_request")
  assert.equal(result.replyMode, "clarify")
  assert.deepEqual(result.missingSlots, ["deliveryDate"])
  assert.equal(result.extracted.servings, 2)
})

test("openai intent client parses catalog query normalization response", async () => {
  const fetchImpl: typeof fetch = async () =>
    new Response(
      JSON.stringify({
        output_text: JSON.stringify({
          normalizedQuery: "beer crate",
          normalizedTerms: ["bier", "beer", "kiste", "crate", "tray"],
          categoryHints: ["drinks", "beer"],
          packagingHint: "crate",
          quantityHint: 1,
          confidence: 0.92,
          shouldClarify: false,
        }),
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    )

  const client = new OpenAIIntentClient({
    apiKey: "test-key",
    fetchImpl,
  })
  const result = await client.interpretCatalogQuery({
    message: "kiste bier",
    contextSummary: "alfies catalogue available",
  })

  assert.equal(result.normalizedQuery, "beer crate")
  assert.ok(result.normalizedTerms.includes("bier"))
  assert.ok(result.normalizedTerms.includes("crate"))
  assert.deepEqual(result.categoryHints, ["drinks", "beer"])
  assert.equal(result.packagingHint, "crate")
})
