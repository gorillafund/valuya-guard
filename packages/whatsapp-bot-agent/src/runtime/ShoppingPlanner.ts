export type ShoppingPlannerDecision =
  | {
      action: "unknown"
      confidence: number
      reply?: string
    }
  | {
      action: "clarify"
      confidence: number
      reply: string
    }
  | {
      action: "recipe"
      confidence: number
      query: string
    }
  | {
      action: "browse_categories" | "browse_products"
      confidence: number
      query?: string
      category?: string
    }
  | {
      action: "add_item" | "remove_item" | "set_item_quantity"
      confidence: number
      query: string
      quantity?: number
    }
  | {
      action: "refine_recipe" | "refine_browse"
      confidence: number
      query?: string
      modifier?: string
      servings?: number
    }
  | {
      action: "choose_option"
      confidence: number
      selectionIndex: number
    }
  | {
      action: "accept_bundle"
      confidence: number
    }

export type PlannerMealCandidate = {
  ingredient: string
  options: Array<{
    productId: number
    label: string
    unitPriceCents?: number
    currency?: string
  }>
}

export type ShoppingMealComposition =
  | {
      title: string
      intro?: string
      selectedProductIds: number[]
      followUpQuestion?: string
      unresolvedIngredients?: string[]
    }
  | null

export interface ShoppingPlanner {
  plan(args: {
    message: string
    contextSummary?: string
  }): Promise<ShoppingPlannerDecision | null>
  composeMeal?(args: {
    message: string
    mealQuery: string
    contextSummary?: string
    candidates: PlannerMealCandidate[]
  }): Promise<ShoppingMealComposition>
}

export function summarizePlannerDecision(decision: ShoppingPlannerDecision | null | undefined): Record<string, unknown> | undefined {
  if (!decision) return undefined
  return {
    plannerAction: decision.action,
    plannerConfidence: decision.confidence,
    ...(decision.action === "recipe" ? { plannerQuery: decision.query } : {}),
    ...(decision.action === "browse_categories" || decision.action === "browse_products"
      ? {
        plannerQuery: decision.query,
        plannerCategory: decision.category,
      }
      : {}),
    ...(decision.action === "add_item" || decision.action === "remove_item" || decision.action === "set_item_quantity"
      ? {
        plannerQuery: decision.query,
        plannerQuantity: decision.quantity,
      }
      : {}),
    ...(decision.action === "refine_recipe" || decision.action === "refine_browse"
      ? {
        plannerQuery: decision.query,
        plannerModifier: decision.modifier,
        plannerServings: decision.servings,
      }
      : {}),
    ...(decision.action === "choose_option" ? { plannerSelectionIndex: decision.selectionIndex } : {}),
    ...(decision.action === "clarify" ? { plannerReply: decision.reply } : {}),
    ...(decision.action === "unknown" && decision.reply ? { plannerReply: decision.reply } : {}),
  }
}
