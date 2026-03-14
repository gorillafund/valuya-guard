import test from "node:test"
import assert from "node:assert/strict"
import { IntentExtractionService, fallbackIntentExtraction } from "./intentExtractionService.js"

test("fallback extraction recognizes recipe-to-cart requests", () => {
  const result = fallbackIntentExtraction("I need ingredients for vegan pasta for 4")
  assert.equal(result.primary_intent, "recipe_to_cart")
  assert.equal(result.task_type, "recipe")
  assert.equal(result.dialogue_move, "new_request")
  assert.equal(result.recipe_request?.dish, "vegan pasta")
  assert.equal(result.recipe_request?.servings, 4)
  assert.deepEqual(result.recipe_request?.dietary, ["vegan"])
})

test("fallback extraction recognizes filtered product browsing", () => {
  const result = fallbackIntentExtraction("show me organic yogurts under 3 euros")
  assert.equal(result.primary_intent, "browse_category")
  assert.equal(result.selection_mode, "browse_only")
  assert.ok(result.categories.includes("dairy"))
  assert.equal(result.product_queries[0]?.organic, true)
  assert.equal(result.product_queries[0]?.price_max, 3)
})

test("fallback extraction recognizes snack occasion browsing", () => {
  const result = fallbackIntentExtraction("snacks for einen fernsehabend")
  assert.equal(result.primary_intent, "browse_category")
  assert.ok(result.categories.includes("snacks"))
})

test("fallback extraction recognizes household paper browsing", () => {
  const result = fallbackIntentExtraction("ich brauche klopapier")
  assert.equal(result.primary_intent, "browse_category")
  assert.equal(result.selection_mode, "browse_only")
  assert.ok(result.categories.includes("household_paper"))
})

test("fallback extraction recognizes append vs replace and stale recipe override", () => {
  const append = fallbackIntentExtraction("auch Milch", "last_shown=Beer One")
  assert.equal(append.selection_mode, "append")
  assert.equal(append.dialogue_move, "refine")

  const replace = fallbackIntentExtraction("nur Tegernseer Helles", "last_shown=Beer One")
  assert.equal(replace.selection_mode, "replace")
  assert.equal(replace.dialogue_move, "correct")

  const recipe = fallbackIntentExtraction("Ich moechte Musaka kochen", "last_shown=Milk One; pending_clarification=Welche Milch?")
  assert.equal(recipe.task_type, "recipe")
  assert.equal(recipe.context_relation, "discard_stale")
})

test("intent extraction service normalizes structured responses", async () => {
  const fetchImpl: typeof fetch = async () =>
    new Response(
      JSON.stringify({
        output_text: JSON.stringify({
          primary_intent: "search_product",
          secondary_intents: ["browse_category"],
          confidence: 0.93,
          task_type: "shopping",
          dialogue_move: "refine",
          selection_mode: "append",
          context_relation: "use_cart",
          reference_strength: "none",
          clarification_needed: false,
          clarification_reason: null,
          needs_clarification: false,
          clarification_question: null,
          categories: ["drinks"],
          product_queries: [
            {
              name: "beer",
              quantity: 1,
              unit: null,
              brand: null,
              qualifiers: ["party"],
              price_max: null,
              organic: null,
              dietary: [],
              sort_preference: "popular",
            },
          ],
          recipe_request: null,
          cart_action: null,
          references_to_previous_context: {
            has_reference: false,
            reference_type: null,
            reference_value: null,
          },
        }),
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    )

  const service = new IntentExtractionService({
    apiKey: "test-key",
    fetchImpl,
  })
  const result = await service.extract({
    message: "bier fuer party",
    contextSummary: "history=user: hallo",
  })

  assert.equal(result.primary_intent, "search_product")
  assert.equal(result.secondary_intents[0], "browse_category")
  assert.equal(result.product_queries[0]?.name, "beer")
  assert.equal(result.product_queries[0]?.sort_preference, "popular")
  assert.equal(result.selection_mode, "append")
})
