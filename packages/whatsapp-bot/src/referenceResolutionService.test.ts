import test from "node:test"
import assert from "node:assert/strict"
import { ReferenceResolutionService } from "./referenceResolutionService.js"
import type { ConversationSnapshot } from "./conversationStateService.js"
import type { IntentExtraction } from "./intentExtractionService.js"

const service = new ReferenceResolutionService()

test("resolves ordinal references from last shown products", () => {
  const extraction: IntentExtraction = {
    primary_intent: "add_to_cart",
    secondary_intents: [],
    confidence: 0.9,
    task_type: "cart_edit",
    dialogue_move: "continue",
    selection_mode: "append",
    context_relation: "use_shown_options",
    reference_strength: "weak",
    clarification_needed: false,
    clarification_reason: null,
    needs_clarification: false,
    clarification_question: null,
    categories: [],
    product_queries: [],
    recipe_request: null,
    cart_action: "add",
    references_to_previous_context: {
      has_reference: true,
      reference_type: "ordinal_selection",
      reference_value: "second",
    },
  }
  const snapshot: ConversationSnapshot = {
    subjectId: "user:1",
    profile: {
      lastShownProducts: [
        { title: "Beer One", sku: "beer-1" },
        { title: "Beer Two", sku: "beer-2" },
      ],
    },
  }

  const result = service.resolve({ extraction, snapshot })
  assert.equal(result.status, "resolved")
  assert.equal(result.resolvedItem?.title, "Beer Two")
})

test("asks for clarification when ordinal reference is not reliable", () => {
  const extraction: IntentExtraction = {
    primary_intent: "add_to_cart",
    secondary_intents: [],
    confidence: 0.9,
    task_type: "cart_edit",
    dialogue_move: "continue",
    selection_mode: "append",
    context_relation: "use_shown_options",
    reference_strength: "weak",
    clarification_needed: false,
    clarification_reason: null,
    needs_clarification: false,
    clarification_question: null,
    categories: [],
    product_queries: [],
    recipe_request: null,
    cart_action: "add",
    references_to_previous_context: {
      has_reference: true,
      reference_type: "ordinal_selection",
      reference_value: "second",
    },
  }

  const result = service.resolve({ extraction, snapshot: { subjectId: "user:1" } })
  assert.equal(result.status, "needs_clarification")
  assert.match(result.clarificationQuestion || "", /nicht sicher/)
})
