import type { ConversationSnapshot } from "./conversationStateService.js"
import type { IntentExtraction } from "./intentExtractionService.js"

export type ContextGovernanceResult = {
  valid_context_sources: Array<"pending_question" | "shown_products" | "cart" | "current_flow">
  discarded_context_sources: Array<"stale_active_candidate" | "pending_options" | "pending_clarification" | "cart_context">
  pending_question_still_valid: boolean
  stale_context_conflict: boolean
  active_anchor: { type: "pending_question" | "shown_option" | "cart"; id: string } | null
  repair_mode: boolean
  repair_reason: string | null
  should_clear_active_product: boolean
  should_clear_pending_options: boolean
  should_clear_pending_clarification: boolean
}

export class ContextGovernanceService {
  evaluate(args: {
    extraction: IntentExtraction
    snapshot: ConversationSnapshot
  }): ContextGovernanceResult {
    const { extraction, snapshot } = args
    const profile = snapshot.profile
    const hasPendingQuestion = Boolean(
      profile?.activeQuestion || profile?.pendingOptions?.options?.length || profile?.pendingClarification?.question,
    )
    const hasShownProducts = Boolean(profile?.lastShownProducts?.length)
    const hasCart = Boolean(snapshot.conversation?.lastCart?.items?.length || profile?.currentCartSnapshot?.items?.length)

    const valid: ContextGovernanceResult["valid_context_sources"] = []
    const discarded: ContextGovernanceResult["discarded_context_sources"] = []
    let pendingQuestionStillValid = false
    let staleContextConflict = false
    let activeAnchor: ContextGovernanceResult["active_anchor"] = null
    let repairMode = false
    let repairReason: string | null = null

    switch (extraction.context_relation) {
      case "use_pending_question":
        if (hasPendingQuestion) {
          valid.push("pending_question")
          pendingQuestionStillValid = true
          activeAnchor = {
            type: "pending_question",
            id: profile?.pendingClarification?.kind || profile?.activeQuestion?.kind || profile?.pendingOptions?.kind || "pending",
          }
        } else {
          staleContextConflict = true
          repairMode = true
          repairReason = "invalid_pending_question_grounding"
        }
        break
      case "use_shown_options":
        if (hasShownProducts || profile?.pendingOptions?.options?.length) {
          valid.push("shown_products")
          activeAnchor = {
            type: "shown_option",
            id: profile?.pendingOptions?.kind || profile?.lastShownProducts?.[0]?.title || "shown_options",
          }
        } else {
          staleContextConflict = true
          repairMode = true
          repairReason = "invalid_shown_options_grounding"
        }
        break
      case "use_cart":
        if (hasCart) {
          valid.push("cart")
          activeAnchor = {
            type: "cart",
            id: snapshot.conversation?.orderId || "cart",
          }
        } else {
          staleContextConflict = true
          repairMode = true
          repairReason = "missing_cart_context"
        }
        break
      case "discard_stale":
        repairMode = true
        repairReason = "discard_stale_context"
        if (profile?.activeProductCandidate) discarded.push("stale_active_candidate")
        if (profile?.pendingOptions) discarded.push("pending_options")
        if (profile?.pendingClarification) discarded.push("pending_clarification")
        break
      default:
        if (hasCart) valid.push("current_flow")
        break
    }

    if (extraction.dialogue_move === "correct" || extraction.dialogue_move === "reject") {
      repairMode = true
      repairReason = repairReason || "user_correction"
      if (profile?.activeProductCandidate) discarded.push("stale_active_candidate")
      if (profile?.pendingClarification) discarded.push("pending_clarification")
    }

    if (extraction.dialogue_move === "switch_topic" || extraction.task_type === "recipe") {
      if (profile?.activeProductCandidate) discarded.push("stale_active_candidate")
      if (profile?.pendingOptions) discarded.push("pending_options")
      if (profile?.pendingClarification) discarded.push("pending_clarification")
      repairMode = repairMode || extraction.dialogue_move === "switch_topic"
      repairReason = repairReason || (extraction.dialogue_move === "switch_topic" ? "topic_switch" : null)
    }

    return {
      valid_context_sources: dedupe(valid),
      discarded_context_sources: dedupe(discarded),
      pending_question_still_valid: pendingQuestionStillValid,
      stale_context_conflict: staleContextConflict,
      active_anchor: activeAnchor,
      repair_mode: repairMode,
      repair_reason: repairReason,
      should_clear_active_product: discarded.includes("stale_active_candidate"),
      should_clear_pending_options: discarded.includes("pending_options"),
      should_clear_pending_clarification: discarded.includes("pending_clarification"),
    }
  }
}

function dedupe<T>(values: T[]): T[] {
  return [...new Set(values)]
}
