import test from "node:test"
import assert from "node:assert/strict"
import { ShoppingRouter } from "./shoppingRouter.js"
import type { IntentExtraction } from "./intentExtractionService.js"
import type { ReferenceResolution } from "./referenceResolutionService.js"
import type { ContextGovernanceResult } from "./contextGovernanceService.js"

const router = new ShoppingRouter()

function baseGovernance(patch?: Partial<ContextGovernanceResult>): ContextGovernanceResult {
  return {
    valid_context_sources: patch?.valid_context_sources || [],
    discarded_context_sources: patch?.discarded_context_sources || [],
    pending_question_still_valid: patch?.pending_question_still_valid ?? false,
    stale_context_conflict: patch?.stale_context_conflict ?? false,
    active_anchor: patch?.active_anchor ?? null,
    repair_mode: patch?.repair_mode ?? false,
    repair_reason: patch?.repair_reason ?? null,
    should_clear_active_product: patch?.should_clear_active_product ?? false,
    should_clear_pending_options: patch?.should_clear_pending_options ?? false,
    should_clear_pending_clarification: patch?.should_clear_pending_clarification ?? false,
  }
}

function baseExtraction(patch: Partial<IntentExtraction>): IntentExtraction {
  return {
    primary_intent: patch.primary_intent || "unknown",
    secondary_intents: patch.secondary_intents || [],
    confidence: patch.confidence ?? 0.5,
    task_type: patch.task_type ?? "shopping",
    dialogue_move: patch.dialogue_move ?? "new_request",
    selection_mode: patch.selection_mode ?? "none",
    context_relation: patch.context_relation ?? "use_current",
    reference_strength: patch.reference_strength ?? "none",
    clarification_needed: patch.clarification_needed ?? false,
    clarification_reason: patch.clarification_reason ?? null,
    needs_clarification: patch.needs_clarification ?? false,
    clarification_question: patch.clarification_question ?? null,
    categories: patch.categories || [],
    product_queries: patch.product_queries || [],
    recipe_request: patch.recipe_request ?? null,
    cart_action: patch.cart_action ?? null,
    references_to_previous_context: patch.references_to_previous_context || {
      has_reference: false,
      reference_type: null,
      reference_value: null,
    },
  }
}

test("checkout always routes to checkout boundary", () => {
  const route = router.route({
    extraction: baseExtraction({
      primary_intent: "checkout",
      confidence: 0.95,
    }),
    referenceResolution: {
      status: "none",
      clarificationQuestion: null,
    },
    governance: baseGovernance(),
  })
  assert.deepEqual(route, { kind: "checkout" })
})

test("weak references route to clarification", () => {
  const route = router.route({
    extraction: baseExtraction({
      primary_intent: "add_to_cart",
      cart_action: "add",
    }),
    referenceResolution: {
      status: "needs_clarification",
      clarificationQuestion: "Welches Produkt meinst du genau?",
    },
    governance: baseGovernance(),
  })
  assert.deepEqual(route, { kind: "clarify", question: "Welches Produkt meinst du genau?" })
})

test("resolved cart mutation keeps deterministic resolved reference", () => {
  const route = router.route({
    extraction: baseExtraction({
      primary_intent: "add_to_cart",
      cart_action: "add",
    }),
    referenceResolution: {
      status: "resolved",
      clarificationQuestion: null,
      resolvedItem: {
        index: 2,
        title: "Beer Two",
        sku: "beer-2",
      },
    } satisfies ReferenceResolution,
    governance: baseGovernance(),
  })
  assert.equal(route.kind, "cart_mutation")
  assert.equal(route.action, "add")
  assert.equal(route.resolvedReference?.title, "Beer Two")
})

test("unsafe weak mutation semantics route to clarification", () => {
  const route = router.route({
    extraction: baseExtraction({
      primary_intent: "add_to_cart",
      cart_action: "add",
      selection_mode: "append",
      context_relation: "unclear",
      reference_strength: "weak",
      references_to_previous_context: {
        has_reference: true,
        reference_type: "ordinal_selection",
        reference_value: "second",
      },
      clarification_question: "Welches Produkt meinst du genau?",
    }),
    referenceResolution: {
      status: "none",
      clarificationQuestion: null,
    },
    governance: baseGovernance({
      stale_context_conflict: true,
    }),
  })
  assert.deepEqual(route, { kind: "clarify", question: "Worauf beziehst du dich genau?" })
})

test("invalid pending-question grounding clarifies instead of mutating", () => {
  const route = router.route({
    extraction: baseExtraction({
      primary_intent: "update_quantity",
      cart_action: "update",
      context_relation: "use_pending_question",
    }),
    referenceResolution: {
      status: "none",
      clarificationQuestion: null,
    },
    governance: baseGovernance({
      pending_question_still_valid: false,
      stale_context_conflict: true,
      repair_reason: "invalid_pending_question_grounding",
    }),
  })

  assert.deepEqual(route, {
    kind: "clarify",
    question: "Worauf beziehst du dich genau? Ich habe gerade keine offene Auswahl mehr.",
  })
})
