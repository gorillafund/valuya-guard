import type { ConversationSnapshot } from "./conversationStateService.js"
import type { IntentExtraction } from "./intentExtractionService.js"

export type ReferenceResolution = {
  status: "none" | "resolved" | "needs_clarification"
  clarificationQuestion: string | null
  resolvedItem?: {
    index?: number
    productId?: number
    sku?: string
    title: string
  }
  resolvedRecipeTitle?: string
}

export class ReferenceResolutionService {
  resolve(args: {
    extraction: IntentExtraction
    snapshot: ConversationSnapshot
  }): ReferenceResolution {
    const { extraction, snapshot } = args
    const reference = extraction.references_to_previous_context
    if (!reference.has_reference) {
      return {
        status: "none",
        clarificationQuestion: null,
      }
    }

    if (reference.reference_type === "ordinal_selection") {
      const index = normalizeOrdinal(reference.reference_value)
      if (!index) {
        return {
          status: "needs_clarification",
          clarificationQuestion: "Welches Produkt meinst du genau?",
        }
      }
      const item = snapshot.profile?.lastShownProducts?.[index - 1]
      if (!item) {
        return {
          status: "needs_clarification",
          clarificationQuestion: "Ich kann die Referenz nicht sicher zuordnen. Welches Produkt meinst du genau?",
        }
      }
      return {
        status: "resolved",
        clarificationQuestion: null,
        resolvedItem: {
          index,
          productId: item.productId,
          sku: item.sku,
          title: item.title,
        },
      }
    }

    if (reference.reference_type === "selected_recipe") {
      const title = snapshot.profile?.selectedRecipeTitle
      if (!title) {
        return {
          status: "needs_clarification",
          clarificationQuestion: "Welches Rezept meinst du genau?",
        }
      }
      return {
        status: "resolved",
        clarificationQuestion: null,
        resolvedRecipeTitle: title,
      }
    }

    if (reference.reference_type === "recent_order") {
      if (!snapshot.conversation?.lastCart?.items?.length) {
        return {
          status: "needs_clarification",
          clarificationQuestion: "Ich kann 'wie letzte Woche' nicht sicher aufloesen. Was soll ich stattdessen zusammenstellen?",
        }
      }
      return {
        status: "resolved",
        clarificationQuestion: null,
      }
    }

    return {
      status: "needs_clarification",
      clarificationQuestion: "Kannst du kurz genauer sagen, worauf du dich beziehst?",
    }
  }
}

function normalizeOrdinal(value: string | null): number | null {
  if (!value) return null
  const normalized = value.trim().toLowerCase()
  if (["1", "first", "erste"].includes(normalized)) return 1
  if (["2", "second", "zweite"].includes(normalized)) return 2
  if (["3", "third", "dritte"].includes(normalized)) return 3
  return null
}
