import test from "node:test"
import assert from "node:assert/strict"
import { applyCartMutation } from "./cartMutationService.js"
import type { IntentExtraction } from "./intentExtractionService.js"
import type { StoredAlfiesProduct } from "./stateStore.js"

const catalog: StoredAlfiesProduct[] = [
  {
    product_id: 1,
    slug: "tegernseer-helles-05l",
    title: "Tegernseer Helles 0.5l",
    price_cents: 159,
    currency: "EUR",
    keywords: ["beer", "helles"],
    category: "Bier",
    updated_at: "2026-03-09T00:00:00.000Z",
  },
  {
    product_id: 2,
    slug: "vollmilch-1l",
    title: "Vollmilch 1L",
    price_cents: 149,
    currency: "EUR",
    keywords: ["milch", "milk"],
    category: "Milch & Alternativen",
    updated_at: "2026-03-09T00:00:00.000Z",
  },
]

function extraction(patch: Partial<IntentExtraction>): IntentExtraction {
  return {
    primary_intent: patch.primary_intent || "add_to_cart",
    secondary_intents: [],
    confidence: 0.9,
    task_type: "shopping",
    dialogue_move: "new_request",
    selection_mode: "append",
    context_relation: "use_current",
    reference_strength: "none",
    clarification_needed: false,
    clarification_reason: null,
    needs_clarification: false,
    clarification_question: null,
    categories: [],
    product_queries: patch.product_queries || [],
    recipe_request: null,
    cart_action: patch.cart_action || "add",
    references_to_previous_context: {
      has_reference: false,
      reference_type: null,
      reference_value: null,
    },
  }
}

test("adds a product to the cart from natural language extraction", () => {
  const result = applyCartMutation({
    cart: { items: [], currency: "EUR" },
    extraction: extraction({
      cart_action: "add",
      product_queries: [{
        name: "Tegernseer Helles",
        quantity: 10,
        unit: null,
        brand: null,
        qualifiers: [],
        price_max: null,
        organic: null,
        dietary: [],
        sort_preference: "best_match",
      }],
    }),
    catalog,
  })
  assert.equal(result.kind, "mutated")
  assert.match(result.message, /10x Tegernseer Helles/)
  assert.equal((result.kind === "mutated" ? result.cart.items.length : 0), 1)
})

test("removes a referenced product from the cart", () => {
  const result = applyCartMutation({
    cart: {
      items: [{ product_id: 1, sku: "tegernseer-helles-05l", name: "Tegernseer Helles 0.5l", qty: 2, unit_price_cents: 159, currency: "EUR" }],
      currency: "EUR",
    },
    extraction: extraction({
      cart_action: "remove",
    }),
    catalog,
    resolvedReference: {
      productId: 1,
      title: "Tegernseer Helles 0.5l",
    },
  })
  assert.equal(result.kind, "mutated")
  assert.equal(result.cart.items.length, 0)
})

test("updates quantity for an existing product", () => {
  const result = applyCartMutation({
    cart: {
      items: [{ product_id: 2, sku: "vollmilch-1l", name: "Vollmilch 1L", qty: 1, unit_price_cents: 149, currency: "EUR" }],
      currency: "EUR",
    },
    extraction: extraction({
      cart_action: "update",
      product_queries: [{
        name: "Vollmilch",
        quantity: 3,
        unit: null,
        brand: null,
        qualifiers: [],
        price_max: null,
        organic: null,
        dietary: [],
        sort_preference: "best_match",
      }],
    }),
    catalog,
  })
  assert.equal(result.kind, "mutated")
  assert.equal((result.kind === "mutated" ? Number((result.cart.items[0] as any).qty) : 0), 3)
})

test("does not mutate on weak unclear reference semantics", () => {
  const result = applyCartMutation({
    cart: { items: [], currency: "EUR" },
    extraction: extraction({
      primary_intent: "add_to_cart",
      cart_action: "add",
      selection_mode: "append",
      context_relation: "unclear",
      reference_strength: "weak",
      clarification_question: "Welches Produkt meinst du genau?",
      references_to_previous_context: {
        has_reference: true,
        reference_type: "ordinal_selection",
        reference_value: "second",
      },
    }),
    catalog,
  })
  assert.equal(result.kind, "clarify")
})
