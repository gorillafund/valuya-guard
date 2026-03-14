import assert from "node:assert/strict"
import test from "node:test"
import { mkdtemp } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { AgentConversationService } from "./agentConversationService.js"
import { CatalogService } from "./catalogService.js"
import { FileStateStore } from "./stateStore.js"
import type { IntentExtraction } from "./intentExtractionService.js"

test("agent conversation fallback handles recipe requests with recipe-backed product options", async () => {
  const store = await createStore("agent-recipe")
  await store.upsertAlfiesProducts([
    {
      product_id: 1,
      slug: "bomba-reis",
      title: "Bomba Reis 1kg",
      price_cents: 499,
      currency: "EUR",
      keywords: ["reis", "paella", "bomba"],
      category: "Reis",
    },
    {
      product_id: 2,
      slug: "safran",
      title: "Safran 0,5g",
      price_cents: 899,
      currency: "EUR",
      keywords: ["safran", "gewuerze", "paella"],
      category: "Gewuerze",
    },
    {
      product_id: 3,
      slug: "gemuese-fond",
      title: "Gemuese Fond",
      price_cents: 299,
      currency: "EUR",
      keywords: ["fond", "bruehe", "paella"],
      category: "Fond & Bruehe",
    },
  ])

  const service = new AgentConversationService({
    catalogService: new CatalogService(store),
  })

  const outcome = await service.maybeHandle({
    message: "Ich moechte Paella kochen",
    extraction: buildExtraction({
      primary_intent: "recipe_to_cart",
      task_type: "recipe",
      recipe_request: {
        dish: "paella",
        cuisine: null,
        servings: null,
        dietary: [],
        exclusions: [],
        max_prep_minutes: null,
      },
      context_relation: "discard_stale",
    }),
    governance: {
      valid_context_sources: [],
      discarded_context_sources: ["stale_active_candidate"],
      pending_question_still_valid: false,
      stale_context_conflict: false,
      active_anchor: null,
      repair_mode: true,
      repair_reason: "discard_stale_context",
      should_clear_active_product: true,
      should_clear_pending_options: true,
      should_clear_pending_clarification: false,
    },
    snapshot: {
      subjectId: "subject-1",
      profile: {},
      conversation: null,
    },
  })

  assert.ok(outcome)
  assert.equal(outcome?.selectedRecipeTitle, "Paella")
  assert.equal(outcome?.pendingOptions?.kind, "product_selection")
  assert.match(outcome?.reply || "", /Paella/)
  assert.ok((outcome?.shownProducts?.length || 0) >= 2)
})

test("agent conversation fallback keeps broad family turns in category browsing", async () => {
  const store = await createStore("agent-category")
  await store.upsertAlfiesProducts([
    {
      product_id: 10,
      slug: "toilettenpapier-soft",
      title: "Soft Toilettenpapier 8 Rollen",
      price_cents: 399,
      currency: "EUR",
      keywords: ["klopapier", "toilettenpapier"],
      category: "Toilettenpapier",
    },
    {
      product_id: 11,
      slug: "haushaltspapier",
      title: "Haushaltspapier 4 Rollen",
      price_cents: 329,
      currency: "EUR",
      keywords: ["haushaltspapier", "kuechenrolle"],
      category: "Haushaltspapier",
    },
  ])

  const service = new AgentConversationService({
    catalogService: new CatalogService(store),
  })

  const outcome = await service.maybeHandle({
    message: "Ich brauche Klopapier",
    extraction: buildExtraction({
      primary_intent: "browse_category",
      categories: ["household_paper"],
      selection_mode: "browse_only",
    }),
    governance: {
      valid_context_sources: [],
      discarded_context_sources: [],
      pending_question_still_valid: false,
      stale_context_conflict: false,
      active_anchor: null,
      repair_mode: false,
      repair_reason: null,
      should_clear_active_product: false,
      should_clear_pending_options: false,
      should_clear_pending_clarification: false,
    },
    snapshot: {
      subjectId: "subject-2",
      profile: {},
      conversation: null,
    },
  })

  assert.ok(outcome)
  assert.equal(outcome?.pendingOptions?.kind, "category_selection")
  assert.match(outcome?.reply || "", /Kategorie/)
  assert.match(outcome?.reply || "", /Toilettenpapier/)
})

test("agent conversation honors model tool decisions for product browsing", async () => {
  const store = await createStore("agent-products")
  await store.upsertAlfiesProducts([
    {
      product_id: 20,
      slug: "ottakringer-helles",
      title: "Ottakringer Helles",
      price_cents: 159,
      currency: "EUR",
      keywords: ["bier", "helles", "maerzen"],
      category: "Helles & Maerzen",
    },
    {
      product_id: 21,
      slug: "linzer-original",
      title: "Linzer Bier Original",
      price_cents: 149,
      currency: "EUR",
      keywords: ["bier", "helles"],
      category: "Helles & Maerzen",
    },
  ])

  const fetchImpl: typeof fetch = async () =>
    new Response(
      JSON.stringify({
        output_text: JSON.stringify({
          mode: "tool",
          tool: "browse_products",
          tool_args: { category: "Helles & Maerzen" },
          acknowledgment: "Alles klar.",
          decision_basis: "test",
        }),
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    )

  const service = new AgentConversationService({
    apiKey: "test-key",
    fetchImpl,
    catalogService: new CatalogService(store),
  })

  const outcome = await service.maybeHandle({
    message: "Zeig mir Helles",
    extraction: buildExtraction({
      primary_intent: "browse_category",
      categories: ["bier"],
      selection_mode: "browse_only",
    }),
    governance: {
      valid_context_sources: [],
      discarded_context_sources: [],
      pending_question_still_valid: false,
      stale_context_conflict: false,
      active_anchor: null,
      repair_mode: false,
      repair_reason: null,
      should_clear_active_product: false,
      should_clear_pending_options: false,
      should_clear_pending_clarification: false,
    },
    snapshot: {
      subjectId: "subject-3",
      profile: {},
      conversation: null,
    },
  })

  assert.ok(outcome)
  assert.equal(outcome?.pendingOptions?.kind, "product_selection")
  assert.match(outcome?.reply || "", /Ottakringer Helles/)
  assert.ok((outcome?.shownProducts?.length || 0) >= 1)
})

test("agent conversation fallback can append a directly resolved product to the cart", async () => {
  const store = await createStore("agent-add")
  await store.upsertAlfiesProducts([
    {
      product_id: 30,
      slug: "hafermilch",
      title: "Hafermilch 1L",
      price_cents: 249,
      currency: "EUR",
      keywords: ["hafermilch", "milch", "drink"],
      category: "Milch & Milchgetraenke",
    },
  ])

  const service = new AgentConversationService({
    catalogService: new CatalogService(store),
  })

  const outcome = await service.maybeHandle({
    message: "Fuege 2x Hafermilch hinzu",
    extraction: buildExtraction({
      primary_intent: "add_to_cart",
      cart_action: "add",
      selection_mode: "append",
      product_queries: [
        {
          name: "Hafermilch",
          quantity: 2,
          unit: null,
          brand: null,
          qualifiers: [],
          price_max: null,
          organic: null,
          dietary: [],
          sort_preference: "best_match",
        },
      ],
    }),
    governance: {
      valid_context_sources: ["cart"],
      discarded_context_sources: [],
      pending_question_still_valid: false,
      stale_context_conflict: false,
      active_anchor: null,
      repair_mode: false,
      repair_reason: null,
      should_clear_active_product: false,
      should_clear_pending_options: false,
      should_clear_pending_clarification: false,
    },
    snapshot: {
      subjectId: "subject-4",
      profile: {},
      conversation: {
        subjectId: "subject-4",
        orderId: "ord_test",
        lastCart: { items: [], total_cents: 0, currency: "EUR" },
        updatedAt: new Date().toISOString(),
      },
    },
  })

  assert.ok(outcome?.cart)
  assert.equal((outcome?.cart?.items || []).length, 1)
  assert.match(outcome?.reply || "", /Hafermilch 1L/)
  assert.equal(outcome?.activeProduct?.title, "Hafermilch 1L")
})

test("agent conversation falls back to category browsing for broad additive family requests", async () => {
  const store = await createStore("agent-broad-add")
  await store.upsertAlfiesProducts([
    {
      product_id: 40,
      slug: "toilettenpapier-soft",
      title: "Soft Toilettenpapier 8 Rollen",
      price_cents: 399,
      currency: "EUR",
      keywords: ["klopapier", "toilettenpapier"],
      category: "Toilettenpapier",
    },
    {
      product_id: 41,
      slug: "haushaltspapier",
      title: "Haushaltspapier 4 Rollen",
      price_cents: 329,
      currency: "EUR",
      keywords: ["haushaltspapier", "kuechenrolle"],
      category: "Haushaltspapier",
    },
  ])

  const service = new AgentConversationService({
    catalogService: new CatalogService(store),
  })

  const outcome = await service.maybeHandle({
    message: "Ich brauche auch Klopapier",
    extraction: buildExtraction({
      primary_intent: "add_to_cart",
      cart_action: "add",
      selection_mode: "append",
      product_queries: [
        {
          name: "Klopapier",
          quantity: null,
          unit: null,
          brand: null,
          qualifiers: [],
          price_max: null,
          organic: null,
          dietary: [],
          sort_preference: "best_match",
        },
      ],
      categories: ["household_paper"],
    }),
    governance: {
      valid_context_sources: ["cart"],
      discarded_context_sources: [],
      pending_question_still_valid: false,
      stale_context_conflict: false,
      active_anchor: null,
      repair_mode: false,
      repair_reason: null,
      should_clear_active_product: false,
      should_clear_pending_options: false,
      should_clear_pending_clarification: false,
    },
    snapshot: {
      subjectId: "subject-5",
      profile: {},
      conversation: {
        subjectId: "subject-5",
        orderId: "ord_test",
        lastCart: { items: [], total_cents: 0, currency: "EUR" },
        updatedAt: new Date().toISOString(),
      },
    },
  })

  assert.ok(!outcome?.cart)
  assert.equal(outcome?.pendingOptions?.kind, "category_selection")
  assert.match(outcome?.reply || "", /Toilettenpapier/)
})

async function createStore(prefix: string): Promise<FileStateStore> {
  const dir = await mkdtemp(join(tmpdir(), `${prefix}-`))
  return new FileStateStore(join(dir, "state.sqlite"))
}

function buildExtraction(overrides: Partial<IntentExtraction>): IntentExtraction {
  return {
    primary_intent: "unknown",
    secondary_intents: [],
    confidence: 0.8,
    task_type: "shopping",
    dialogue_move: "new_request",
    selection_mode: "none",
    context_relation: "use_current",
    reference_strength: "none",
    clarification_needed: false,
    clarification_reason: null,
    needs_clarification: false,
    clarification_question: null,
    categories: [],
    product_queries: [],
    recipe_request: null,
    cart_action: null,
    references_to_previous_context: {
      has_reference: false,
      reference_type: null,
      reference_value: null,
    },
    ...overrides,
  }
}
