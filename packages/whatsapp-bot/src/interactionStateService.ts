import type { ActiveQuestionState, ConversationProfile, InteractionState } from "./stateStore.js"

export function deriveInteractionStateForPendingOptions(
  pendingOptions: ConversationProfile["pendingOptions"],
): InteractionState {
  const assumption = pendingOptions?.sourceCategory || pendingOptions?.sourceQuery || pendingOptions?.prompt || ""
  switch (pendingOptions?.kind) {
    case "cart_item_action":
      return {
        phase: "cart_edit",
        last_assistant_act: "asked_choice",
        expected_reply_type: "option_index",
        repair_mode: false,
        assumption_under_discussion: assumption ? { type: "cart_item_action", value: assumption } : null,
      }
    case "cart_item_selection":
      return {
        phase: "cart_edit",
        last_assistant_act: "asked_choice",
        expected_reply_type: "option_index",
        repair_mode: false,
        assumption_under_discussion: assumption ? { type: "cart_item", value: assumption } : null,
      }
    case "occasion_selection":
      return {
        phase: "browsing",
        last_assistant_act: "asked_choice",
        expected_reply_type: "option_index",
        repair_mode: false,
        assumption_under_discussion: assumption ? { type: "occasion", value: assumption } : null,
      }
    case "category_selection":
      return {
        phase: "browsing",
        last_assistant_act: "asked_choice",
        expected_reply_type: "option_index",
        repair_mode: false,
        assumption_under_discussion: assumption ? { type: "category", value: assumption } : null,
      }
    case "product_selection":
      return {
        phase: "browsing",
        last_assistant_act: "showed_products",
        expected_reply_type: "option_index",
        repair_mode: false,
        assumption_under_discussion: assumption ? { type: "product_family", value: assumption } : null,
      }
    default:
      return idleInteractionState()
  }
}

export function deriveInteractionStateForActiveQuestion(
  question: ActiveQuestionState,
  editMode: ConversationProfile["activeEditMode"],
): InteractionState {
  if (!question) return idleInteractionState()
  if (question.kind === "quantity_for_product") {
    return {
      phase: editMode === "replace_with_single_product" ? "cart_edit" : "browsing",
      last_assistant_act: "asked_quantity",
      expected_reply_type: "quantity",
      repair_mode: false,
      assumption_under_discussion: { type: "product", value: question.productTitle },
    }
  }
  return {
    phase: editMode === "replace_with_single_product" ? "cart_edit" : "browsing",
    last_assistant_act: "asked_choice",
    expected_reply_type: "free_text",
    repair_mode: true,
    assumption_under_discussion: { type: "product", value: question.productTitle },
  }
}

export function deriveInteractionStateForClarification(args: {
  kind: string
  question: string
  reason?: string | null
}): InteractionState {
  const expectedReplyType = /(^|\W)(ja|nein)(\W|$)/i.test(args.question) ? "yes_no" : "free_text"
  return {
    phase: "disambiguation",
    last_assistant_act: expectedReplyType === "yes_no" ? "asked_yes_no" : "asked_clarification",
    expected_reply_type: expectedReplyType,
    repair_mode: true,
    pending_clarification_reason: args.reason || null,
    assumption_under_discussion: { type: args.kind, value: args.question },
  }
}

export function confirmedMutationInteractionState(productTitle?: string): InteractionState {
  return {
    phase: "cart_edit",
    last_assistant_act: "confirmed_mutation",
    expected_reply_type: "free_text",
    repair_mode: false,
    assumption_under_discussion: productTitle ? { type: "product", value: productTitle } : null,
  }
}

export function idleInteractionState(): InteractionState {
  return {
    phase: "idle",
    last_assistant_act: "summarized_state",
    expected_reply_type: "free_text",
    repair_mode: false,
    assumption_under_discussion: null,
  }
}

