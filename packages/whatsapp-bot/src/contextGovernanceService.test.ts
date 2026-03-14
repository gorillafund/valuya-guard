import test from "node:test"
import assert from "node:assert/strict"
import { ContextGovernanceService } from "./contextGovernanceService.js"
import type { IntentExtraction } from "./intentExtractionService.js"

const service = new ContextGovernanceService()

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

test("governance discards stale product context for clear recipe turns", () => {
  const result = service.evaluate({
    extraction: baseExtraction({
      primary_intent: "recipe_to_cart",
      task_type: "recipe",
      dialogue_move: "switch_topic",
      context_relation: "discard_stale",
    }),
    snapshot: {
      subjectId: "user:1",
      profile: {
        activeProductCandidate: { title: "Vollmilch" },
        pendingOptions: {
          kind: "product_selection",
          prompt: "Welche Milch meinst du?",
          options: [{ id: "milk", label: "Vollmilch", value: "vollmilch" }],
        },
      },
    },
  })

  assert.equal(result.repair_mode, true)
  assert.equal(result.should_clear_active_product, true)
  assert.equal(result.should_clear_pending_options, true)
  assert.ok(result.discarded_context_sources.includes("stale_active_candidate"))
})

test("governance marks invalid numeric grounding as stale context conflict", () => {
  const result = service.evaluate({
    extraction: baseExtraction({
      primary_intent: "add_to_cart",
      dialogue_move: "continue",
      context_relation: "use_pending_question",
      references_to_previous_context: {
        has_reference: true,
        reference_type: "ordinal_selection",
        reference_value: "2",
      },
      reference_strength: "weak",
    }),
    snapshot: {
      subjectId: "user:2",
      profile: undefined,
    },
  })

  assert.equal(result.stale_context_conflict, true)
  assert.equal(result.pending_question_still_valid, false)
  assert.equal(result.repair_reason, "invalid_pending_question_grounding")
})
