import type {
  PlannerMealCandidate,
  ShoppingPlanner,
  ShoppingMealComposition,
  ShoppingPlannerDecision,
} from "./ShoppingPlanner.js"

type FetchLike = typeof fetch

export class OpenAIShoppingPlanner implements ShoppingPlanner {
  private readonly apiKey: string
  private readonly model: string
  private readonly fetchImpl: FetchLike

  constructor(args: { apiKey: string; model?: string; fetchImpl?: FetchLike }) {
    this.apiKey = args.apiKey.trim()
    this.model = args.model?.trim() || "gpt-4.1-mini"
    this.fetchImpl = args.fetchImpl || fetch
  }

  async plan(args: {
    message: string
    contextSummary?: string
  }): Promise<ShoppingPlannerDecision | null> {
    const response = await this.fetchImpl(
      "https://api.openai.com/v1/responses",
      {
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
                "You plan the next action for a WhatsApp Alfies shopping concierge.",
                "Alfies is a grocery shopping and delivery experience with a real product catalog.",
                "This concierge helps a shopper browse products, discover meal ideas, build a grocery basket, refine choices, and continue to checkout.",
                "You are not a general chatbot. Prefer concrete shopping actions over broad conversational replies.",
                "Treat the task as grocery intent planning for a shopping flow.",
                "Return strict JSON only.",
                "Do not invent catalog items, categories, prices, or recipe names.",
                "Prefer grounded shopping actions over vague summaries.",
                "You are only deciding the next action, not answering as the bot.",
                "Available actions: unknown, clarify, recipe, browse_categories, browse_products, add_item, remove_item, set_item_quantity, refine_recipe, refine_browse, choose_option, accept_bundle.",
                "Use choose_option only for explicit numeric replies like 1, 2, 3.",
                "Use accept_bundle only for clear confirmations like 'alles', 'passt', 'ja'.",
                "Use refine_recipe only if the context already contains an active recipe flow.",
                "If the user starts a new topic, do not reuse an older recipe or browse query.",
                "If the message contains cancel/restart semantics like 'cancel', 'abbrechen', 'neu', 'von vorne', prefer unknown rather than forcing a shopping action.",
                "If the message asks for more results like 'mehr', 'gibts noch mehr', only continue the previous browse if context clearly shows an active browse flow.",
                "Broad family requests like 'Getraenke', 'Snacks', 'Bier', 'Wein' should usually map to browse_products.",
                "Use browse_categories mainly when the shopper asks for categories explicitly.",
                "For browse_categories, query may be empty only when the shopper explicitly asks to see all categories or the whole assortment.",
                "For recipe requests, use the dish or meal idea from the current message, not from stale context.",
                "If the message describes a meal goal like 'ein schnelles Gericht fuer Kinder fuer vier Personen', prefer recipe or clarify, not refine_recipe unless an active recipe already exists in context.",
                "If the message is just 'cancel' or 'neu', do not convert it into a catalog query.",
                "If the message is a broad shopping family like 'Getraenke' or 'Snacks', prefer browse_products with that family query.",
                "If the message explicitly asks for categories like 'Zeige mir die Kategorien', use browse_categories.",
                "Never output a stale recipe name from earlier context unless the current message clearly refers back to it.",
                "Examples:",
                "Message: 'Zeig mir Getraenke' -> {\"action\":\"browse_products\",\"query\":\"Getraenke\"}",
                "Message: 'Zeige mir die Kategorien' -> {\"action\":\"browse_categories\",\"query\":\"\"}",
                "Message: 'gibts noch mehr?' with active browse query pizza -> {\"action\":\"browse_products\",\"query\":\"pizza\"}",
                "Message: 'gibts noch mehr?' with no active browse query -> {\"action\":\"unknown\"}",
                "Message: 'cancel' -> {\"action\":\"unknown\"}",
                "Message: 'neu' -> {\"action\":\"unknown\"}",
                "Message: 'Ich moechte Paella machen heute' -> {\"action\":\"recipe\",\"query\":\"Paella\"}",
                "Message: 'Ich moechte ein schnelles Gericht fuer Kinder vier Personen' with no active recipe -> {\"action\":\"clarify\",\"reply\":\"...\"} or {\"action\":\"recipe\",\"query\":\"...\"}",
                "Message: 'vegetarisch' with active recipe Paella -> {\"action\":\"refine_recipe\",\"modifier\":\"vegetarisch\"}",
              ].join(" "),
            },
            {
              role: "user",
              content: [
                `Context summary: ${args.contextSummary || "none"}`,
                `Message: ${args.message}`,
                "Return JSON with keys: action, confidence, query, category, quantity, servings, modifier, selectionIndex, reply.",
                "Only include keys that are relevant for the chosen action.",
                "Set confidence between 0 and 1.",
              ].join("\n"),
            },
          ],
        }),
      },
    )
    const body = await safeParseJson(response)
    if (!response.ok) {
      throw new Error(
        `openai_shopping_planner_http_${response.status}:${JSON.stringify(body).slice(0, 300)}`,
      )
    }
    return normalizePlannerDecision(extractResponseText(body))
  }

  async composeMeal(args: {
    message: string
    mealQuery: string
    contextSummary?: string
    candidates: PlannerMealCandidate[]
  }): Promise<ShoppingMealComposition> {
    const response = await this.fetchImpl(
      "https://api.openai.com/v1/responses",
      {
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
                "You compose a grounded grocery starter basket for a WhatsApp Alfies shopping concierge.",
                "Alfies is a grocery shopping and delivery experience with a real product catalog.",
                "You may only choose from the candidate products provided to you.",
                "Do not invent products, brands, prices, or product IDs.",
                "Prefer a coherent small starter basket over a long list.",
                "If the shopper request is broad or ambiguous, choose 2 to 4 sensible items and ask one short follow-up question.",
                "If the request needs clarification, still choose only products that clearly fit and keep the rest unresolved.",
                "Return strict JSON only.",
                "Return keys: title, intro, selectedProductIds, followUpQuestion, unresolvedIngredients.",
              ].join(" "),
            },
            {
              role: "user",
              content: [
                `Context summary: ${args.contextSummary || "none"}`,
                `Meal request: ${args.mealQuery}`,
                `Latest shopper message: ${args.message}`,
                "Candidate groups:",
                JSON.stringify(args.candidates),
              ].join("\n"),
            },
          ],
        }),
      },
    )
    const body = await safeParseJson(response)
    if (!response.ok) {
      throw new Error(
        `openai_meal_composer_http_${response.status}:${JSON.stringify(body).slice(0, 300)}`,
      )
    }
    return normalizeMealComposition(extractResponseText(body), args.candidates)
  }
}

function extractResponseText(body: unknown): string {
  const record =
    body && typeof body === "object" ? (body as Record<string, unknown>) : {}
  if (typeof record.output_text === "string" && record.output_text.trim()) {
    return record.output_text.trim()
  }
  const output = Array.isArray(record.output) ? record.output : []
  const chunks: string[] = []
  for (const item of output) {
    const content = Array.isArray((item as Record<string, unknown>)?.content)
      ? ((item as Record<string, unknown>).content as Array<
          Record<string, unknown>
        >)
      : []
    for (const part of content) {
      if (typeof part.text === "string" && part.text.trim()) {
        chunks.push(part.text.trim())
      }
    }
  }
  return chunks.join("\n").trim()
}

function normalizePlannerDecision(text: string): ShoppingPlannerDecision {
  const raw = parseJson(text)
  const action = readAction(raw.action)
  const confidence = normalizeConfidence(raw.confidence)
  if (action === "clarify") {
    return {
      action,
      confidence,
      reply:
        readString(raw.reply) ||
        "Kannst du mir kurz sagen, wonach ich genau schauen soll?",
    }
  }
  if (action === "recipe") {
    return {
      action,
      confidence,
      query: readString(raw.query) || "",
    }
  }
  if (action === "browse_categories" || action === "browse_products") {
    return {
      action,
      confidence,
      ...(readString(raw.query) !== undefined
        ? { query: readString(raw.query) }
        : {}),
      ...(readString(raw.category)
        ? { category: readString(raw.category) }
        : {}),
    }
  }
  if (
    action === "add_item" ||
    action === "remove_item" ||
    action === "set_item_quantity"
  ) {
    return {
      action,
      confidence,
      query: readString(raw.query) || "",
      ...(typeof normalizePositiveInt(raw.quantity) === "number"
        ? { quantity: normalizePositiveInt(raw.quantity) }
        : {}),
    }
  }
  if (action === "refine_recipe" || action === "refine_browse") {
    return {
      action,
      confidence,
      ...(readString(raw.query) ? { query: readString(raw.query) } : {}),
      ...(readString(raw.modifier)
        ? { modifier: readString(raw.modifier) }
        : {}),
      ...(typeof normalizePositiveInt(raw.servings) === "number"
        ? { servings: normalizePositiveInt(raw.servings) }
        : {}),
    }
  }
  if (action === "choose_option") {
    return {
      action,
      confidence,
      selectionIndex: normalizePositiveInt(raw.selectionIndex) || 1,
    }
  }
  if (action === "accept_bundle") {
    return {
      action,
      confidence,
    }
  }
  return {
    action: "unknown",
    confidence,
    ...(readString(raw.reply) ? { reply: readString(raw.reply) } : {}),
  }
}

function normalizeMealComposition(
  text: string,
  candidates: PlannerMealCandidate[],
): ShoppingMealComposition {
  const raw = parseJson(text)
  const allowedProductIds = new Set(
    candidates.flatMap((group) => group.options.map((option) => option.productId)),
  )
  const selectedProductIds = Array.isArray(raw.selectedProductIds)
    ? raw.selectedProductIds
      .map((value) => normalizePositiveInt(value))
      .filter((value): value is number => typeof value === "number" && allowedProductIds.has(value))
    : []

  const title = readString(raw.title)
  if (!title || !selectedProductIds.length) return null

  const unresolvedIngredients = Array.isArray(raw.unresolvedIngredients)
    ? raw.unresolvedIngredients.filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    : undefined

  return {
    title,
    selectedProductIds,
    ...(readString(raw.intro) ? { intro: readString(raw.intro) } : {}),
    ...(readString(raw.followUpQuestion) ? { followUpQuestion: readString(raw.followUpQuestion) } : {}),
    ...(unresolvedIngredients?.length ? { unresolvedIngredients } : {}),
  }
}

function parseJson(text: string): Record<string, unknown> {
  try {
    return JSON.parse(text) as Record<string, unknown>
  } catch {
    const match = text.match(/\{[\s\S]*\}/)
    if (!match)
      throw new Error(`openai_shopping_planner_non_json:${text.slice(0, 300)}`)
    return JSON.parse(match[0]) as Record<string, unknown>
  }
}

function readAction(value: unknown): ShoppingPlannerDecision["action"] {
  switch (value) {
    case "clarify":
    case "recipe":
    case "browse_categories":
    case "browse_products":
    case "add_item":
    case "remove_item":
    case "set_item_quantity":
    case "refine_recipe":
    case "refine_browse":
    case "choose_option":
    case "accept_bundle":
      return value
    default:
      return "unknown"
  }
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined
}

function normalizePositiveInt(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value) && value > 0)
    return Math.trunc(value)
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value)
    if (Number.isFinite(parsed) && parsed > 0) return Math.trunc(parsed)
  }
  return undefined
}

function normalizeConfidence(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.max(0, Math.min(1, value))
  }
  return 0
}

async function safeParseJson(response: Response): Promise<unknown> {
  const text = await response.text()
  if (!text.trim()) return {}
  try {
    return JSON.parse(text)
  } catch {
    return { raw: text.slice(0, 2000) }
  }
}
