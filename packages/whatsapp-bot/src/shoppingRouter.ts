import type { IntentExtraction } from "./intentExtractionService.js"
import type { ReferenceResolution } from "./referenceResolutionService.js"
import type { ContextGovernanceResult } from "./contextGovernanceService.js"

export type ShoppingRoute =
  | { kind: "help" }
  | { kind: "checkout" }
  | { kind: "payment_status" }
  | { kind: "show_cart" }
  | { kind: "recipe_idea" }
  | { kind: "recipe_to_cart" }
  | { kind: "search_product" }
  | { kind: "browse_category" }
  | { kind: "cart_mutation"; action: "add" | "remove" | "update"; resolvedReference?: ReferenceResolution["resolvedItem"] }
  | { kind: "clarify"; question: string }
  | { kind: "unknown"; question: string }

export class ShoppingRouter {
  route(args: {
    extraction: IntentExtraction
    referenceResolution: ReferenceResolution
    governance: ContextGovernanceResult
  }): ShoppingRoute {
    const { extraction, referenceResolution, governance } = args

    const unsafeMutation =
      extraction.selection_mode === "clarify" ||
      governance.stale_context_conflict ||
      (extraction.context_relation === "unclear" && extraction.cart_action !== "show") ||
      (extraction.reference_strength === "weak" &&
        extraction.references_to_previous_context.has_reference &&
        (extraction.cart_action === "add" || extraction.cart_action === "remove" || extraction.cart_action === "update"))

    if (referenceResolution.status === "needs_clarification") {
      return {
        kind: "clarify",
        question: referenceResolution.clarificationQuestion || "Kannst du das kurz praezisieren?",
      }
    }
    if (
      extraction.context_relation === "use_pending_question" &&
      !governance.pending_question_still_valid
    ) {
      return {
        kind: "clarify",
        question: "Worauf beziehst du dich genau? Ich habe gerade keine offene Auswahl mehr.",
      }
    }
    if (extraction.needs_clarification || extraction.clarification_needed || unsafeMutation) {
      return {
        kind: "clarify",
        question: extraction.clarification_question ||
          governance.repair_reason === "invalid_pending_question_grounding"
          ? "Worauf beziehst du dich genau?"
          : governance.repair_reason === "invalid_shown_options_grounding"
          ? "Meinst du die letzte Liste oder etwas Neues?"
          : governance.repair_reason === "missing_cart_context"
          ? "Es gibt noch keinen aktiven Warenkorb. Was soll ich fuer dich suchen?"
          :
          (extraction.clarification_reason === "weak_reference"
            ? "Worauf beziehst du dich genau?"
            : "Kannst du das kurz genauer sagen?"),
      }
    }

    switch (extraction.primary_intent) {
      case "help":
        return { kind: "help" }
      case "checkout":
        return { kind: "checkout" }
      case "payment_status":
        return { kind: "payment_status" }
      case "show_cart":
        return { kind: "show_cart" }
      case "recipe_idea":
        return { kind: "recipe_idea" }
      case "recipe_to_cart":
        return { kind: "recipe_to_cart" }
      case "browse_category":
        return { kind: "browse_category" }
      case "search_product":
        return { kind: "search_product" }
      case "add_to_cart":
        return {
          kind: "cart_mutation",
          action: "add",
          resolvedReference: referenceResolution.resolvedItem,
        }
      case "remove_from_cart":
        return {
          kind: "cart_mutation",
          action: "remove",
          resolvedReference: referenceResolution.resolvedItem,
        }
      case "update_quantity":
        return {
          kind: "cart_mutation",
          action: "update",
          resolvedReference: referenceResolution.resolvedItem,
        }
      case "unknown":
      default:
        return {
          kind: "unknown",
          question: extraction.clarification_question || "Was soll ich fuer dich suchen oder zusammenstellen?",
        }
    }
  }
}
