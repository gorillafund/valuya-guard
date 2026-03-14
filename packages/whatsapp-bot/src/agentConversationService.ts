type FetchLike = typeof fetch

import type { ContextGovernanceResult } from "./contextGovernanceService.js"
import type { ConversationSnapshot } from "./conversationStateService.js"
import type { IntentExtraction } from "./intentExtractionService.js"
import type { CatalogService } from "./catalogService.js"
import type { CartState, ConversationProfile } from "./stateStore.js"
import { applyResolvedCartMutation } from "./cartMutationService.js"
import {
  formatAgentCategoryReply,
  formatAgentCartMutationReply,
  formatAgentDirectAnswer,
  formatAgentProductReply,
  formatAgentRecipeReply,
} from "./replyFormatter.js"

export type AgentToolName =
  | "browse_categories"
  | "browse_products"
  | "recipe_to_products"
  | "show_product_details"
  | "add_to_cart"
  | "replace_cart_with"

export type AgentDecision = {
  mode: "reply" | "clarify" | "tool"
  text?: string | null
  acknowledgment?: string | null
  tool?: AgentToolName | null
  tool_args?: Record<string, unknown> | null
  decision_basis?: string | null
}

export type AgentConversationOutcome = {
  reply: string
  pendingOptions?: ConversationProfile["pendingOptions"]
  shownProducts?: NonNullable<ConversationProfile["lastShownProducts"]>
  selectedRecipeTitle?: string
  cart?: CartState
  activeProduct?: ConversationProfile["activeProductCandidate"]
}

export class AgentConversationService {
  private readonly apiKey?: string
  private readonly model: string
  private readonly fetchImpl: FetchLike
  private readonly catalogService: CatalogService

  constructor(args: {
    apiKey?: string
    model?: string
    fetchImpl?: FetchLike
    catalogService: CatalogService
  }) {
    this.apiKey = args.apiKey?.trim() || undefined
    this.model = args.model?.trim() || "gpt-4.1-mini"
    this.fetchImpl = args.fetchImpl || fetch
    this.catalogService = args.catalogService
  }

  shouldHandle(args: {
    extraction: IntentExtraction
    governance: ContextGovernanceResult
  }): boolean {
    const { extraction, governance } = args
    if (extraction.primary_intent === "checkout" || extraction.primary_intent === "payment_status" || extraction.primary_intent === "help") {
      return false
    }
    if (extraction.cart_action === "remove" || extraction.cart_action === "update") {
      return false
    }
    return (
      (
        extraction.cart_action === "add" &&
        (extraction.selection_mode === "append" || extraction.selection_mode === "replace")
      ) ||
      extraction.task_type === "recipe" ||
      extraction.selection_mode === "browse_only" ||
      extraction.primary_intent === "browse_category" ||
      extraction.primary_intent === "search_product" ||
      governance.repair_mode ||
      extraction.dialogue_move === "correct" ||
      extraction.dialogue_move === "switch_topic"
    )
  }

  async maybeHandle(args: {
    message: string
    extraction: IntentExtraction
    governance: ContextGovernanceResult
    snapshot: ConversationSnapshot
  }): Promise<AgentConversationOutcome | null> {
    if (!this.shouldHandle(args)) return null

    const decision = await this.decide(args)
    if (decision.mode === "reply" || decision.mode === "clarify") {
      const text = String(decision.text || "").trim()
      return text
        ? {
            reply: formatAgentDirectAnswer(text, decision.acknowledgment),
          }
        : null
    }
    if (decision.mode !== "tool" || !decision.tool) return null

    switch (decision.tool) {
      case "browse_categories": {
        const query = String(decision.tool_args?.query || args.message).trim()
        const page = normalizePage(decision.tool_args?.page)
        const result = await this.catalogService.browseCategories({ query, page })
        if (!result.options.length) {
          return {
            reply: formatAgentDirectAnswer(
              `Ich finde gerade keine passende Kategorie fuer '${query}'. Kannst du den Wunsch etwas genauer sagen?`,
              decision.acknowledgment,
            ),
          }
        }
        return {
          reply: formatAgentCategoryReply({
            prompt: result.prompt,
            options: result.options,
            hasMore: result.hasMore,
            acknowledgment: decision.acknowledgment,
          }),
          pendingOptions: {
            kind: "category_selection",
            prompt: result.prompt,
            options: result.options,
            offset: page * 6,
            sourceQuery: result.sourceQuery,
            selectionMode: inferSelectionMode(args.extraction),
          },
        }
      }
      case "browse_products": {
        const query = decision.tool_args?.query ? String(decision.tool_args.query) : undefined
        const category = decision.tool_args?.category ? String(decision.tool_args.category) : undefined
        const page = normalizePage(decision.tool_args?.page)
        const result = await this.catalogService.browseProducts({ query, category, page })
        if (!result.options.length) {
          return {
            reply: formatAgentDirectAnswer(
              "Ich habe dazu noch keine guten Produkt-Treffer. Magst du es etwas genauer eingrenzen?",
              decision.acknowledgment,
            ),
          }
        }
        return {
          reply: formatAgentProductReply({
            prompt: result.prompt,
            options: result.options,
            hasMore: result.hasMore,
            acknowledgment: decision.acknowledgment,
          }),
          pendingOptions: {
            kind: "product_selection",
            prompt: result.prompt,
            options: result.options,
            offset: page * 8,
            sourceQuery: result.sourceQuery,
            sourceCategory: result.sourceCategory,
            selectionMode: inferSelectionMode(args.extraction),
          },
          shownProducts: this.catalogService.buildShownReferences(result.options),
        }
      }
      case "recipe_to_products": {
        const recipeQuery = String(decision.tool_args?.query || args.message).trim()
        const result = await this.catalogService.recipeToProducts({
          query: recipeQuery,
          preferences: args.snapshot.profile?.shoppingPreferences,
        })
        if (!result || result.options.length === 0) {
          return {
            reply: formatAgentDirectAnswer(
              `Ich habe fuer '${recipeQuery}' noch keine gute Zutaten-Zuordnung. Soll ich zuerst nach Reis, Gemuese oder Gewuerzen suchen?`,
              decision.acknowledgment,
            ),
          }
        }
        return {
          reply: formatAgentRecipeReply({
            recipeTitle: result.recipeTitle,
            options: result.options,
            unresolvedIngredients: result.unresolvedIngredients,
            acknowledgment: decision.acknowledgment,
          }),
          pendingOptions: {
            kind: "product_selection",
            prompt: `Welche Zutat moechtest du fuer ${result.recipeTitle} zuerst ansehen?`,
            options: result.options,
            selectionMode: "add_to_existing_cart",
          },
          shownProducts: this.catalogService.buildShownReferences(result.options),
          selectedRecipeTitle: result.recipeTitle,
        }
      }
      case "add_to_cart":
      case "replace_cart_with": {
        const query = String(decision.tool_args?.query || args.extraction.product_queries[0]?.name || args.message).trim()
        const quantity = normalizeQuantity(decision.tool_args?.quantity, args.extraction.product_queries[0]?.quantity)
        const resolved = await this.catalogService.resolveDirectProductQuery(query)
        if (resolved.kind === "resolved") {
          const details = await this.catalogService.showProductDetails(resolved.option.productId || 0)
          if (!details) {
            return {
              reply: formatAgentDirectAnswer(
                `Ich konnte '${query}' gerade nicht sicher zuordnen. Kannst du den Produktnamen noch etwas genauer sagen?`,
                decision.acknowledgment,
              ),
            }
          }
          const mutation = applyResolvedCartMutation({
            cart: args.snapshot.conversation?.lastCart,
            product: details,
            quantity,
            mode: decision.tool === "replace_cart_with" ? "replace" : "append",
          })
          if (mutation.kind === "clarify") {
            return {
              reply: formatAgentDirectAnswer(mutation.message, decision.acknowledgment),
            }
          }
          return {
            reply: formatAgentCartMutationReply({
              message: mutation.message,
              cart: mutation.cart,
              acknowledgment: decision.acknowledgment,
            }),
            cart: mutation.cart,
            activeProduct: mutation.activeProduct,
            shownProducts: mutation.activeProduct
              ? [
                  {
                    productId: mutation.activeProduct.productId,
                    sku: mutation.activeProduct.sku,
                    title: mutation.activeProduct.title,
                  },
                ]
              : undefined,
          }
        }
        if (resolved.kind === "category_browse") {
          return {
            reply: formatAgentCategoryReply({
              prompt: resolved.prompt,
              options: resolved.options,
              acknowledgment: decision.acknowledgment,
            }),
            pendingOptions: {
              kind: "category_selection",
              prompt: resolved.prompt,
              options: resolved.options,
              selectionMode: decision.tool === "replace_cart_with" ? "replace_with_single_product" : "add_to_existing_cart",
            },
          }
        }
        if (resolved.kind === "product_browse") {
          return {
            reply: formatAgentProductReply({
              prompt: resolved.prompt,
              options: resolved.options,
              acknowledgment: decision.acknowledgment,
            }),
            pendingOptions: {
              kind: "product_selection",
              prompt: resolved.prompt,
              options: resolved.options,
              selectionMode: decision.tool === "replace_cart_with" ? "replace_with_single_product" : "add_to_existing_cart",
            },
            shownProducts: this.catalogService.buildShownReferences(resolved.options),
          }
        }
        return {
          reply: formatAgentDirectAnswer(
            `Ich finde fuer '${query}' noch keinen sicheren Treffer. Magst du es etwas genauer sagen?`,
            decision.acknowledgment,
          ),
        }
      }
      case "show_product_details":
      default:
        return null
    }
  }

  private async decide(args: {
    message: string
    extraction: IntentExtraction
    governance: ContextGovernanceResult
    snapshot: ConversationSnapshot
  }): Promise<AgentDecision> {
    if (!this.apiKey) {
      return fallbackAgentDecision(args)
    }

    const response = await this.fetchImpl("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: this.model,
        input: [
          {
            role: "system",
            content: [
              "You are the conversation planner for a WhatsApp grocery concierge.",
              "Be conservative. Do not invent products, prices, availability, stock, discounts, totals, or payment states.",
              "Use tools for catalog, recipe, and safe cart actions only.",
              "Prefer broad browsing over exact SKU commitment for broad family terms.",
              "Explicit recipe or dish requests should override stale product browsing context.",
              "Return strict JSON only.",
            ].join(" "),
          },
          {
            role: "user",
            content: [
              `Latest message: ${args.message}`,
              `Interaction summary: ${buildSnapshotSummary(args.snapshot)}`,
              `Extracted intent: ${JSON.stringify({
                primary_intent: args.extraction.primary_intent,
                task_type: args.extraction.task_type,
                dialogue_move: args.extraction.dialogue_move,
                selection_mode: args.extraction.selection_mode,
                categories: args.extraction.categories,
                product_queries: args.extraction.product_queries.map((query) => query.name),
                recipe_request: args.extraction.recipe_request?.dish,
              })}`,
              `Governance: ${JSON.stringify({
                repair_mode: args.governance.repair_mode,
                repair_reason: args.governance.repair_reason,
                active_anchor: args.governance.active_anchor,
              })}`,
              "Available tools:",
              "- browse_categories(query, page)",
              "- browse_products(query, category, page)",
              "- recipe_to_products(query)",
              "- add_to_cart(query, quantity)",
              "- replace_cart_with(query, quantity)",
              "Return JSON with: mode, text, acknowledgment, tool, tool_args, decision_basis.",
              "mode must be one of: reply, clarify, tool.",
              "If mode is tool, choose exactly one tool.",
            ].join("\n"),
          },
        ],
      }),
    })

    const body = await safeParseJson(response)
    if (!response.ok) {
      return fallbackAgentDecision(args)
    }
    return normalizeAgentDecision(extractResponseText(body), args)
  }
}

function fallbackAgentDecision(args: {
  message: string
  extraction: IntentExtraction
  governance: ContextGovernanceResult
}): AgentDecision {
  if (args.extraction.task_type === "recipe") {
    return {
      mode: "tool",
      tool: "recipe_to_products",
      tool_args: { query: args.message },
      acknowledgment: "Alles klar.",
      decision_basis: "recipe_first_fallback",
    }
  }
  if (args.extraction.cart_action === "add" && args.extraction.selection_mode === "replace") {
    return {
      mode: "tool",
      tool: "replace_cart_with",
      tool_args: {
        query: args.extraction.product_queries[0]?.name || args.message,
        quantity: args.extraction.product_queries[0]?.quantity || 1,
      },
      acknowledgment: "Alles klar.",
      decision_basis: "replace_cart_fallback",
    }
  }
  if (args.extraction.cart_action === "add" && args.extraction.selection_mode === "append") {
    return {
      mode: "tool",
      tool: "add_to_cart",
      tool_args: {
        query: args.extraction.product_queries[0]?.name || args.message,
        quantity: args.extraction.product_queries[0]?.quantity || 1,
      },
      acknowledgment: "Alles klar.",
      decision_basis: "add_to_cart_fallback",
    }
  }
  if (args.governance.repair_mode && args.extraction.categories[0]) {
    return {
      mode: "tool",
      tool: "browse_categories",
      tool_args: { query: args.extraction.categories[0] },
      acknowledgment: "Okay.",
      decision_basis: "repair_mode_category_fallback",
    }
  }
  if (args.extraction.primary_intent === "browse_category" || args.extraction.selection_mode === "browse_only") {
    return {
      mode: "tool",
      tool: "browse_categories",
      tool_args: {
        query: prefersRawMessageQuery(args.extraction.categories[0]) ? args.message : (args.extraction.categories[0] || args.message),
      },
      acknowledgment: "Alles klar.",
      decision_basis: "browse_category_fallback",
    }
  }
  if (args.extraction.primary_intent === "search_product") {
    return {
      mode: "tool",
      tool: "browse_products",
      tool_args: {
        query: args.extraction.product_queries[0]?.name || args.message,
      },
      acknowledgment: "Alles klar.",
      decision_basis: "browse_products_fallback",
    }
  }
  return {
    mode: "clarify",
    text: "Kannst du kurz sagen, ob du etwas suchen, durchstoebern oder zusammenstellen willst?",
    acknowledgment: "Okay.",
    decision_basis: "fallback_clarify",
  }
}

function normalizeAgentDecision(raw: string, args: {
  message: string
  extraction: IntentExtraction
  governance: ContextGovernanceResult
}): AgentDecision {
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>
    const mode = parsed.mode === "reply" || parsed.mode === "clarify" || parsed.mode === "tool"
      ? parsed.mode
      : "clarify"
    const tool = parsed.tool === "browse_categories" ||
        parsed.tool === "browse_products" ||
        parsed.tool === "recipe_to_products" ||
        parsed.tool === "show_product_details" ||
        parsed.tool === "add_to_cart" ||
        parsed.tool === "replace_cart_with"
      ? parsed.tool
      : null
    return {
      mode,
      text: typeof parsed.text === "string" ? parsed.text : null,
      acknowledgment: typeof parsed.acknowledgment === "string" ? parsed.acknowledgment : null,
      tool,
      tool_args: parsed.tool_args && typeof parsed.tool_args === "object"
        ? parsed.tool_args as Record<string, unknown>
        : null,
      decision_basis: typeof parsed.decision_basis === "string" ? parsed.decision_basis : null,
    }
  } catch {
    return fallbackAgentDecision(args)
  }
}

function normalizeQuantity(value: unknown, fallback: unknown): number {
  const parsed = Math.trunc(Number(value ?? fallback ?? 1))
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1
}

function buildSnapshotSummary(snapshot: ConversationSnapshot): string {
  const cartItems = snapshot.conversation?.lastCart?.items
  const cartSummary = Array.isArray(cartItems)
    ? cartItems
        .slice(0, 4)
        .map((item) => {
          const row = item as Record<string, unknown>
          return `${row.qty || 1}x ${row.name || row.title || "Artikel"}`
        })
        .join(", ")
    : "none"
  return JSON.stringify({
    onboardingStage: snapshot.onboardingStage || null,
    addressKnown: Boolean(snapshot.profile?.deliveryAddressHint),
    preferences: snapshot.profile?.shoppingPreferences || {},
    selectedRecipeTitle: snapshot.profile?.selectedRecipeTitle || null,
    pendingOptionsKind: snapshot.profile?.pendingOptions?.kind || null,
    activeQuestionKind: snapshot.profile?.activeQuestion?.kind || null,
    cartSummary,
    lastShownProducts: snapshot.profile?.lastShownProducts?.map((item) => item.title).slice(0, 5) || [],
  })
}

function normalizePage(value: unknown): number {
  const parsed = Math.max(0, Math.trunc(Number(value || 0)))
  return Number.isFinite(parsed) ? parsed : 0
}

function inferSelectionMode(extraction: IntentExtraction): "add_to_existing_cart" | "replace_with_single_product" | undefined {
  if (extraction.selection_mode === "append") return "add_to_existing_cart"
  if (extraction.selection_mode === "replace") return "replace_with_single_product"
  return undefined
}

function prefersRawMessageQuery(category: string | undefined): boolean {
  return !category || category.includes("_")
}

async function safeParseJson(response: Response): Promise<unknown> {
  try {
    return await response.json()
  } catch {
    return null
  }
}

function extractResponseText(body: unknown): string {
  const record = body && typeof body === "object" ? body as Record<string, unknown> : {}
  if (typeof record.output_text === "string" && record.output_text.trim()) return record.output_text.trim()
  const output = Array.isArray(record.output) ? record.output : []
  const chunks: string[] = []
  for (const item of output) {
    const content = item && typeof item === "object" && Array.isArray((item as Record<string, unknown>).content)
      ? (item as Record<string, unknown>).content as Array<Record<string, unknown>>
      : []
    for (const part of content) {
      if (typeof part.text === "string" && part.text.trim()) chunks.push(part.text.trim())
    }
  }
  return chunks.join("\n").trim()
}
