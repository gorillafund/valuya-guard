type FetchLike = typeof fetch
import type {
  ContextRelation,
  DialogueMove,
  ReferenceStrength,
  SelectionMode,
  TaskType,
} from "./conversationSemantics.js"
import { mergeAcceptedAliasesIntoSignals } from "./trainingRuntimeConfig.js"

export type PrimaryIntent =
  | "recipe_idea"
  | "recipe_to_cart"
  | "browse_category"
  | "search_product"
  | "add_to_cart"
  | "remove_from_cart"
  | "update_quantity"
  | "show_cart"
  | "checkout"
  | "payment_status"
  | "help"
  | "unknown"

export type ProductQuery = {
  name: string
  quantity: number | null
  unit: string | null
  brand: string | null
  qualifiers: string[]
  price_max: number | null
  organic: boolean | null
  dietary: string[]
  sort_preference: "cheapest" | "best_match" | "popular" | null
}

export type RecipeRequest = {
  dish: string | null
  cuisine: string | null
  servings: number | null
  dietary: string[]
  exclusions: string[]
  max_prep_minutes: number | null
}

export type PreviousContextReference = {
  has_reference: boolean
  reference_type: string | null
  reference_value: string | null
}

export type IntentExtraction = {
  primary_intent: PrimaryIntent
  secondary_intents: string[]
  confidence: number
  task_type: TaskType
  dialogue_move: DialogueMove
  selection_mode: SelectionMode
  context_relation: ContextRelation
  reference_strength: ReferenceStrength
  clarification_needed: boolean
  clarification_reason: string | null
  needs_clarification: boolean
  clarification_question: string | null
  categories: string[]
  product_queries: ProductQuery[]
  recipe_request: RecipeRequest | null
  cart_action: "add" | "remove" | "update" | "show" | null
  references_to_previous_context: PreviousContextReference
}

export class IntentExtractionService {
  private readonly apiKey?: string
  private readonly model: string
  private readonly fetchImpl: FetchLike

  constructor(args?: { apiKey?: string; model?: string; fetchImpl?: FetchLike }) {
    this.apiKey = args?.apiKey?.trim() || undefined
    this.model = args?.model?.trim() || "gpt-4.1-mini"
    this.fetchImpl = args?.fetchImpl || fetch
  }

  async extract(args: { message: string; contextSummary?: string }): Promise<IntentExtraction> {
    if (!this.apiKey) return fallbackIntentExtraction(args.message, args.contextSummary)

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
              "You are the semantic understanding layer for a WhatsApp shopping concierge.",
              "Return strict JSON only.",
              "Do not answer conversationally.",
              "Do not invent products, prices, availability, totals, discounts, or payment states.",
              "Only extract dialogue meaning, entities, ambiguity, references, and one clarification question when needed.",
              "Be conservative: if uncertain between acting and clarifying, prefer clarifying.",
              "Explicit recipe or dish requests can override stale shopping context.",
              "Broad family terms should not force a specific SKU.",
            ].join(" "),
          },
          {
            role: "user",
            content: [
              `Context summary: ${args.contextSummary || "none"}`,
              `Latest message: ${args.message}`,
              "Return exactly this JSON shape: primary_intent, secondary_intents, confidence, task_type, dialogue_move, selection_mode, context_relation, reference_strength, clarification_needed, clarification_reason, needs_clarification, clarification_question, categories, product_queries, recipe_request, cart_action, references_to_previous_context.",
            ].join("\n"),
          },
        ],
      }),
    })

    const body = await safeParseJson(response)
    if (!response.ok) {
      throw new Error(`intent_extraction_http_${response.status}:${JSON.stringify(body).slice(0, 300)}`)
    }
    return normalizeIntentExtraction(extractResponseText(body), args.message)
  }
}

export function fallbackIntentExtraction(message: string, contextSummary?: string): IntentExtraction {
  const normalized = normalizeLoose(message)
  const servings = extractNumberFromMessage(normalized)
  const dietary = extractDietary(normalized)
  const priceMax = extractPriceMax(normalized)
  const categories = extractCategories(normalized)
  const reference = extractReference(normalized)
  const productNames = extractProductNames(normalized, categories)
  const semantics = inferDialogueSemantics({
    normalized,
    rawMessage: message,
    contextSummary,
    primaryIntent: "unknown",
    categories,
    productNames,
    reference,
    cartAction: null,
  })

  if (!normalized) {
    return buildUnknown("Was brauchst du heute genau?")
  }
  if (/\b(help|hilfe|start)\b/.test(normalized)) {
    return baseExtraction({
      primary_intent: "help",
      confidence: 0.95,
      task_type: "support",
      dialogue_move: "ask_question",
    })
  }
  if (/\b(checkout|pay|bezahlen|bestellen)\b/.test(normalized)) {
    return baseExtraction({
      primary_intent: "checkout",
      confidence: 0.9,
      task_type: "checkout",
      dialogue_move: "confirm",
    })
  }
  if (/\b(status|payment status|zahlung|bezahlt)\b/.test(normalized)) {
    return baseExtraction({
      primary_intent: "payment_status",
      confidence: 0.82,
      task_type: "support",
      dialogue_move: "ask_question",
    })
  }
  if (/\b(cart|warenkorb|show cart)\b/.test(normalized)) {
    return baseExtraction({
      primary_intent: "show_cart",
      confidence: 0.85,
      cart_action: "show",
      task_type: "cart_edit",
      dialogue_move: "ask_question",
      selection_mode: "none",
      context_relation: "use_cart",
    })
  }
  if (/\b(what can i cook|was kann ich kochen|recipe ideas|rezeptidee|rezept idee)\b/.test(normalized)) {
    return baseExtraction({
      primary_intent: "recipe_idea",
      confidence: 0.84,
      recipe_request: {
        dish: null,
        cuisine: null,
        servings,
        dietary,
        exclusions: [],
        max_prep_minutes: null,
      },
      task_type: "recipe",
      dialogue_move: "new_request",
      context_relation: shouldDiscardStaleContext(normalized, contextSummary) ? "discard_stale" : "use_current",
    })
  }
  if (/\b(ingredients for|zutaten fur|zutaten fuer|zutaten)\b/.test(normalized)) {
    return baseExtraction({
      primary_intent: "recipe_to_cart",
      confidence: 0.84,
      recipe_request: {
        dish: extractDish(normalized),
        cuisine: null,
        servings,
        dietary,
        exclusions: [],
        max_prep_minutes: null,
      },
      product_queries: productNames.map((name) => buildProductQuery(name, servings, dietary, priceMax, normalized)),
      task_type: "recipe",
      dialogue_move: "new_request",
      context_relation: shouldDiscardStaleContext(normalized, contextSummary) ? "discard_stale" : "use_current",
    })
  }
  if (/\b(fernsehabend|movie night|filmabend|spieleabend|game night)\b/.test(normalized) &&
      /\b(snack|snacks|chips|getranke|getraenke|drinks|bier|beer|wein|wine)\b/.test(normalized)) {
    return baseExtraction({
      primary_intent: "browse_category",
      confidence: 0.83,
      categories,
      product_queries: productNames.map((name) => buildProductQuery(name, servings, dietary, priceMax, normalized)),
      task_type: "shopping",
      dialogue_move: "new_request",
      selection_mode: "browse_only",
    })
  }
  if (/\b(add|hinzu|dazu|nimm|pack)\b/.test(normalized)) {
    return baseExtraction({
      primary_intent: "add_to_cart",
      confidence: reference.has_reference ? 0.86 : 0.74,
      cart_action: "add",
      references_to_previous_context: reference,
      product_queries: productNames.map((name) => buildProductQuery(name, servings, dietary, priceMax, normalized)),
      needs_clarification: !reference.has_reference && productNames.length === 0,
      clarification_question: !reference.has_reference && productNames.length === 0
        ? "Welches Produkt soll ich zum Warenkorb hinzufuegen?"
        : null,
      task_type: "cart_edit",
      dialogue_move: semantics.dialogue_move,
      selection_mode: "append",
      context_relation: semantics.context_relation,
      reference_strength: semantics.reference_strength,
      clarification_reason: !reference.has_reference && productNames.length === 0 ? "missing_product_target" : null,
    })
  }
  if (/\b(remove|entfern|loesch|lösch)\b/.test(normalized)) {
    return baseExtraction({
      primary_intent: "remove_from_cart",
      confidence: 0.8,
      cart_action: "remove",
      references_to_previous_context: reference,
      product_queries: productNames.map((name) => buildProductQuery(name, servings, dietary, priceMax, normalized)),
      task_type: "cart_edit",
      dialogue_move: semantics.dialogue_move,
      selection_mode: "remove",
      context_relation: semantics.context_relation,
      reference_strength: semantics.reference_strength,
    })
  }
  if (/\b(under|unter)\s+\d/.test(normalized) || /\borganic|bio|regional|category|kategorie|show me|zeig\b/.test(normalized)) {
    return baseExtraction({
      primary_intent: categories.length ? "browse_category" : "search_product",
      confidence: 0.78,
      categories,
      product_queries: productNames.map((name) => buildProductQuery(name, servings, dietary, priceMax, normalized)),
      task_type: "shopping",
      dialogue_move: semantics.dialogue_move,
      selection_mode: semantics.selection_mode !== "none" ? semantics.selection_mode : categories.length ? "browse_only" : semantics.selection_mode,
    })
  }
  if (reference.has_reference) {
    return baseExtraction({
      primary_intent: "add_to_cart",
      confidence: 0.7,
      cart_action: "add",
      references_to_previous_context: reference,
      task_type: "cart_edit",
      dialogue_move: semantics.dialogue_move,
      selection_mode: semantics.selection_mode === "none" ? "append" : semantics.selection_mode,
      context_relation: semantics.context_relation,
      reference_strength: semantics.reference_strength,
    })
  }
  if (looksRecipeLike(normalized)) {
    return baseExtraction({
      primary_intent: "recipe_to_cart",
      confidence: 0.72,
      categories,
      recipe_request: {
        dish: extractDish(normalized),
        cuisine: null,
        servings,
        dietary,
        exclusions: [],
        max_prep_minutes: null,
      },
      product_queries: productNames.map((name) => buildProductQuery(name, servings, dietary, priceMax, normalized)),
      task_type: "recipe",
      dialogue_move: "switch_topic",
      context_relation: shouldDiscardStaleContext(normalized, contextSummary) ? "discard_stale" : "use_current",
    })
  }
  if (productNames.length || categories.length) {
    return baseExtraction({
      primary_intent: categories.length ? "browse_category" : "search_product",
      confidence: 0.7,
      categories,
      product_queries: productNames.map((name) => buildProductQuery(name, servings, dietary, priceMax, normalized)),
      task_type: "shopping",
      dialogue_move: semantics.dialogue_move,
      selection_mode: semantics.selection_mode !== "none" ? semantics.selection_mode : categories.length ? "browse_only" : semantics.selection_mode,
      context_relation: semantics.context_relation,
      reference_strength: semantics.reference_strength,
    })
  }
  return buildUnknown("Was genau soll ich bei Alfies suchen oder fuer welchen Anlass soll ich etwas zusammenstellen?")
}

function normalizeIntentExtraction(text: string, fallbackMessage: string): IntentExtraction {
  const raw = parseJson(text)
  const fallback = fallbackIntentExtraction(fallbackMessage)
  return {
    primary_intent: isPrimaryIntent(raw.primary_intent) ? raw.primary_intent : fallback.primary_intent,
    secondary_intents: Array.isArray(raw.secondary_intents) ? raw.secondary_intents.map(String) : fallback.secondary_intents,
    confidence: normalizeConfidence(raw.confidence) || fallback.confidence,
    task_type: isTaskType(raw.task_type) ? raw.task_type : fallback.task_type,
    dialogue_move: isDialogueMove(raw.dialogue_move) ? raw.dialogue_move : fallback.dialogue_move,
    selection_mode: isSelectionMode(raw.selection_mode) ? raw.selection_mode : fallback.selection_mode,
    context_relation: isContextRelation(raw.context_relation) ? raw.context_relation : fallback.context_relation,
    reference_strength: isReferenceStrength(raw.reference_strength) ? raw.reference_strength : fallback.reference_strength,
    clarification_needed: raw.clarification_needed === true,
    clarification_reason: normalizeNullableString(raw.clarification_reason) ?? fallback.clarification_reason,
    needs_clarification: raw.needs_clarification === true,
    clarification_question:
      typeof raw.clarification_question === "string" && raw.clarification_question.trim()
        ? raw.clarification_question.trim()
        : raw.needs_clarification === true
          ? fallback.clarification_question
          : null,
    categories: Array.isArray(raw.categories) ? raw.categories.map(String).map(normalizeLoose).filter(Boolean) : fallback.categories,
    product_queries: normalizeProductQueries(raw.product_queries, fallback.product_queries),
    recipe_request: normalizeRecipeRequest(raw.recipe_request, fallback.recipe_request),
    cart_action: isCartAction(raw.cart_action) ? raw.cart_action : fallback.cart_action,
    references_to_previous_context: normalizeReference(raw.references_to_previous_context, fallback.references_to_previous_context),
  }
}

function normalizeProductQueries(raw: unknown, fallback: ProductQuery[]): ProductQuery[] {
  if (!Array.isArray(raw)) return fallback
  return raw
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
    .map((item) => ({
      name: typeof item.name === "string" ? item.name.trim() : "",
      quantity: normalizeNullableNumber(item.quantity),
      unit: normalizeNullableString(item.unit),
      brand: normalizeNullableString(item.brand),
      qualifiers: Array.isArray(item.qualifiers) ? item.qualifiers.map(String) : [],
      price_max: normalizeNullableNumber(item.price_max),
      organic: typeof item.organic === "boolean" ? item.organic : null,
      dietary: Array.isArray(item.dietary) ? item.dietary.map(String) : [],
      sort_preference: isSortPreference(item.sort_preference) ? item.sort_preference : null,
    }))
    .filter((item) => item.name)
}

function normalizeRecipeRequest(raw: unknown, fallback: RecipeRequest | null): RecipeRequest | null {
  if (!raw || typeof raw !== "object") return fallback
  const item = raw as Record<string, unknown>
  return {
    dish: normalizeNullableString(item.dish),
    cuisine: normalizeNullableString(item.cuisine),
    servings: normalizeNullableNumber(item.servings),
    dietary: Array.isArray(item.dietary) ? item.dietary.map(String) : [],
    exclusions: Array.isArray(item.exclusions) ? item.exclusions.map(String) : [],
    max_prep_minutes: normalizeNullableNumber(item.max_prep_minutes),
  }
}

function normalizeReference(raw: unknown, fallback: PreviousContextReference): PreviousContextReference {
  if (!raw || typeof raw !== "object") return fallback
  const item = raw as Record<string, unknown>
  return {
    has_reference: item.has_reference === true,
    reference_type: normalizeNullableString(item.reference_type),
    reference_value: normalizeNullableString(item.reference_value),
  }
}

function baseExtraction(patch: Partial<IntentExtraction>): IntentExtraction {
  return {
    primary_intent: patch.primary_intent || "unknown",
    secondary_intents: patch.secondary_intents || [],
    confidence: patch.confidence ?? 0.5,
    task_type: patch.task_type || "unknown",
    dialogue_move: patch.dialogue_move || "new_request",
    selection_mode: patch.selection_mode || "none",
    context_relation: patch.context_relation || "use_current",
    reference_strength: patch.reference_strength || "none",
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

function buildUnknown(question: string): IntentExtraction {
  return baseExtraction({
    primary_intent: "unknown",
    confidence: 0.2,
    task_type: "unknown",
    dialogue_move: "ask_question",
    selection_mode: "clarify",
    context_relation: "unclear",
    needs_clarification: true,
    clarification_reason: "unknown_request",
    clarification_question: question,
  })
}

function inferDialogueSemantics(args: {
  normalized: string
  rawMessage: string
  contextSummary?: string
  primaryIntent: PrimaryIntent
  categories: string[]
  productNames: string[]
  reference: PreviousContextReference
  cartAction: IntentExtraction["cart_action"]
}): Pick<
  IntentExtraction,
  "task_type" | "dialogue_move" | "selection_mode" | "context_relation" | "reference_strength" | "clarification_reason"
> {
  const { normalized, contextSummary, categories, productNames, reference, cartAction } = args
  const hasPending = Boolean(contextSummary?.includes("pending_clarification="))
  const hasShown = Boolean(contextSummary?.includes("last_shown="))
  const hasCart = Boolean(contextSummary?.includes("selected_recipe=") || contextSummary?.includes("last_shown="))
  const recipeSignal = looksRecipeLike(normalized) || /\b(kochen|machen|rezept|ausprobieren)\b/.test(normalized)
  const broadFamily = categories.length > 0 && productNames.length === 0

  let taskType: TaskType = "shopping"
  if (recipeSignal) taskType = "recipe"
  else if (cartAction) taskType = "cart_edit"
  else if (/\b(help|hilfe|start|status)\b/.test(normalized)) taskType = "support"

  let dialogueMove: DialogueMove = "new_request"
  if (/\b(cancel|abbrechen|stopp|stop)\b/.test(normalized)) dialogueMove = "abort"
  else if (isGenericYes(normalized)) dialogueMove = "confirm"
  else if (isGenericNo(normalized)) dialogueMove = "reject"
  else if (/\b(ich meine|nein|anders|statt|nur|ersetz|tausche|korrigier)\b/.test(normalized)) dialogueMove = "correct"
  else if (/\b(auch|noch|zusatzlich|zusaetzlich|add|dazu)\b/.test(normalized)) dialogueMove = "refine"
  else if (recipeSignal && shouldDiscardStaleContext(normalized, contextSummary)) dialogueMove = "switch_topic"
  else if (/^\d+$/.test(normalized) || reference.has_reference) dialogueMove = "continue"
  else if (/\?$/.test(args.rawMessage.trim()) || /\b(welche|welcher|welches|was|wie|gibt es|hast du)\b/.test(normalized)) dialogueMove = "ask_question"

  let selectionMode: SelectionMode = "none"
  if (cartAction === "remove") selectionMode = "remove"
  else if (cartAction === "update") selectionMode = "set_quantity"
  else if (/\b(nur|statt|ersetz|tausche)\b/.test(normalized)) selectionMode = "replace"
  else if (/\b(auch|noch|zusatzlich|zusaetzlich|add|dazu)\b/.test(normalized) || cartAction === "add") selectionMode = "append"
  else if (broadFamily) selectionMode = "browse_only"
  else if (!productNames.length && !categories.length) selectionMode = "clarify"

  let contextRelation: ContextRelation = "use_current"
  if (recipeSignal && shouldDiscardStaleContext(normalized, contextSummary)) contextRelation = "discard_stale"
  else if ((isGenericYes(normalized) || isGenericNo(normalized) || /^\d+$/.test(normalized)) && hasPending) contextRelation = "use_pending_question"
  else if ((reference.has_reference || /^\d+$/.test(normalized)) && hasShown) contextRelation = "use_shown_options"
  else if ((/\b(auch|noch|dazu|hinzu)\b/.test(normalized) || broadFamily) && hasCart) contextRelation = "use_cart"
  else if (reference.has_reference && !hasShown) contextRelation = "unclear"

  let referenceStrength: ReferenceStrength = "none"
  if (reference.has_reference) {
    referenceStrength = reference.reference_type === "selected_recipe" || reference.reference_type === "recent_order"
      ? "strong"
      : "weak"
  }

  let clarificationReason: string | null = null
  if (selectionMode === "clarify") clarificationReason = "underspecified_request"
  else if (referenceStrength === "weak" && contextRelation === "unclear") clarificationReason = "weak_reference"
  else if (broadFamily && dialogueMove === "ask_question") clarificationReason = "broad_family_needs_browse"

  return {
    task_type: taskType,
    dialogue_move: dialogueMove,
    selection_mode: selectionMode,
    context_relation: contextRelation,
    reference_strength: referenceStrength,
    clarification_reason: clarificationReason,
  }
}

function shouldDiscardStaleContext(normalized: string, contextSummary?: string): boolean {
  if (!contextSummary) return false
  return looksRecipeLike(normalized) || /\b(kochen|machen|rezept|ausprobieren)\b/.test(normalized)
}

function isGenericYes(value: string): boolean {
  return /^(ja|yes|klar|bitte|genau|ok|okay)$/.test(value)
}

function isGenericNo(value: string): boolean {
  return /^(nein|no|nee|nicht)$/.test(value)
}

function buildProductQuery(
  name: string,
  quantity: number | null,
  dietary: string[],
  priceMax: number | null,
  normalizedMessage: string,
): ProductQuery {
  return {
    name,
    quantity,
    unit: null,
    brand: null,
    qualifiers: collectQualifiers(normalizedMessage),
    price_max: priceMax,
    organic: /\bbio|organic\b/.test(normalizedMessage) ? true : null,
    dietary,
    sort_preference: /\bcheap|cheapest|guenstig|günstig|budget\b/.test(normalizedMessage) ? "cheapest" : "best_match",
  }
}

function extractReference(normalized: string): PreviousContextReference {
  const ordinal = normalized.match(/\b(the\s+)?(first|second|third|erste|zweite|dritte|1|2|3)\b/)
  if (ordinal) {
    return {
      has_reference: true,
      reference_type: "ordinal_selection",
      reference_value: String(ordinal[2] || ordinal[1] || "").trim(),
    }
  }
  if (/\bsame as last week\b|\bwie letzte woche\b/.test(normalized)) {
    return {
      has_reference: true,
      reference_type: "recent_order",
      reference_value: "last_week",
    }
  }
  if (/\b(that recipe|dieses rezept|das rezept)\b/.test(normalized)) {
    return {
      has_reference: true,
      reference_type: "selected_recipe",
      reference_value: "selected_recipe",
    }
  }
  return {
    has_reference: false,
    reference_type: null,
    reference_value: null,
  }
}

function extractDietary(normalized: string): string[] {
  const dietary = new Set<string>()
  if (/\bvegan\b/.test(normalized)) dietary.add("vegan")
  if (/\bvegetarian\b|\bvegetarisch\b/.test(normalized)) dietary.add("vegetarian")
  if (/\bgluten free\b|\bglutenfrei\b/.test(normalized)) dietary.add("gluten_free")
  return [...dietary]
}

function extractCategories(normalized: string): string[] {
  const found = new Set<string>()
  for (const [category, signals] of Object.entries(CATEGORY_SIGNALS)) {
    if (signals.some((signal) => normalized.includes(signal))) found.add(category)
  }
  return [...found]
}

function extractProductNames(normalized: string, categories: string[]): string[] {
  const stripped = normalized
    .replace(/\b(add|hinzu|show me|zeig mir|i need|ich brauche|suche|finde|under|unter|organic|bio|regional|for|fuer|fur|mit|personen|party|tonight|heute abend)\b/g, " ")
    .replace(/\d+([.,]\d+)?\s*(eur|euro)?/g, " ")
    .replace(/\s+/g, " ")
    .trim()
  if (!stripped) return categories.length ? [] : []
  const candidates = stripped
    .split(/,| und | and /)
    .map((value) => value.trim())
    .filter((value) => value && value.length >= 3)
  return candidates
    .filter((value) => !categories.includes(value))
    .slice(0, 4)
}

function extractDish(normalized: string): string | null {
  const cleaned = normalized
    .replace(/\b(i need ingredients for|ingredients for|zutaten fur|zutaten fuer|what can i cook with|was kann ich kochen mit)\b/g, " ")
    .replace(/\bfor\s+\d+\b|\bfuer\s+\d+\b|\bmit\s+\d+\s+personen\b/g, " ")
    .replace(/\s+/g, " ")
    .trim()
  return cleaned || null
}

function extractNumberFromMessage(normalized: string): number | null {
  const match = normalized.match(/\bfor\s+(\d{1,2})\b|\bfuer\s+(\d{1,2})\b|\bmit\s+(\d{1,2})\s+personen\b|\b(\d{1,2})x\b/)
  const value = match?.slice(1).find(Boolean)
  if (!value) return null
  const parsed = Math.trunc(Number(value))
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

function extractPriceMax(normalized: string): number | null {
  const match = normalized.match(/\bunder\s+(\d+(?:[.,]\d+)?)\b|\bunter\s+(\d+(?:[.,]\d+)?)\b/)
  const value = match?.slice(1).find(Boolean)
  if (!value) return null
  const parsed = Number(String(value).replace(",", "."))
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

function looksRecipeLike(normalized: string): boolean {
  return /\b(pasta|taco|tacos|curry|pizza|salad|salat|tofu|spinach|spinat|vegan|vegetarian|vegetarisch|musaka|moussaka|lasagne|lasagna|paella)\b/.test(normalized)
}

function collectQualifiers(normalized: string): string[] {
  const qualifiers = new Set<string>()
  if (/\bparty\b/.test(normalized)) qualifiers.add("party")
  if (/\btonight|heute abend\b/.test(normalized)) qualifiers.add("tonight")
  if (/\bregional\b/.test(normalized)) qualifiers.add("regional")
  if (/\bbio|organic\b/.test(normalized)) qualifiers.add("organic")
  return [...qualifiers]
}

function normalizeLoose(value: string): string {
  return String(value || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\w\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

function isPrimaryIntent(value: unknown): value is PrimaryIntent {
  return typeof value === "string" && [
    "recipe_idea",
    "recipe_to_cart",
    "browse_category",
    "search_product",
    "add_to_cart",
    "remove_from_cart",
    "update_quantity",
    "show_cart",
    "checkout",
    "payment_status",
    "help",
    "unknown",
  ].includes(value)
}

function isTaskType(value: unknown): value is TaskType {
  return typeof value === "string" && ["shopping", "recipe", "cart_edit", "checkout", "support", "smalltalk", "unknown"].includes(value)
}

function isDialogueMove(value: unknown): value is DialogueMove {
  return typeof value === "string" &&
    ["new_request", "continue", "refine", "correct", "confirm", "reject", "switch_topic", "ask_question", "abort"].includes(value)
}

function isSelectionMode(value: unknown): value is SelectionMode {
  return typeof value === "string" &&
    ["append", "replace", "remove", "set_quantity", "browse_only", "clarify", "none"].includes(value)
}

function isContextRelation(value: unknown): value is ContextRelation {
  return typeof value === "string" &&
    ["use_current", "use_shown_options", "use_cart", "use_pending_question", "discard_stale", "unclear"].includes(value)
}

function isReferenceStrength(value: unknown): value is ReferenceStrength {
  return value === "strong" || value === "weak" || value === "none"
}

function isCartAction(value: unknown): value is IntentExtraction["cart_action"] {
  return value === "add" || value === "remove" || value === "update" || value === "show" || value === null
}

function isSortPreference(value: unknown): value is ProductQuery["sort_preference"] {
  return value === "cheapest" || value === "best_match" || value === "popular" || value === null
}

function normalizeConfidence(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0
  return Math.max(0, Math.min(1, value))
}

function normalizeNullableNumber(value: unknown): number | null {
  if (value == null || value === "") return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function normalizeNullableString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null
}

function extractResponseText(body: unknown): string {
  const record = body && typeof body === "object" ? (body as Record<string, unknown>) : {}
  if (typeof record.output_text === "string" && record.output_text.trim()) return record.output_text.trim()
  const output = Array.isArray(record.output) ? record.output : []
  const chunks: string[] = []
  for (const item of output) {
    const content = Array.isArray((item as Record<string, unknown>).content)
      ? ((item as Record<string, unknown>).content as Array<Record<string, unknown>>)
      : []
    for (const part of content) {
      if (typeof part.text === "string" && part.text.trim()) chunks.push(part.text.trim())
    }
  }
  return chunks.join("\n").trim()
}

function parseJson(text: string): Record<string, unknown> {
  try {
    return JSON.parse(text) as Record<string, unknown>
  } catch {
    const match = text.match(/\{[\s\S]*\}/)
    if (!match) throw new Error(`intent_extraction_non_json:${text.slice(0, 300)}`)
    return JSON.parse(match[0]) as Record<string, unknown>
  }
}

async function safeParseJson(response: Response): Promise<unknown> {
  const text = await response.text()
  if (!text) return {}
  try {
    return JSON.parse(text)
  } catch {
    return { raw: text }
  }
}

const BASE_CATEGORY_SIGNALS: Record<string, string[]> = {
  drinks: ["drink", "drinks", "getranke", "getranke", "beverages", "party"],
  beer: ["bier", "beer", "lager", "maerzen", "helles"],
  snacks: ["snack", "snacks", "chips", "nuts", "party"],
  dairy: ["yogurt", "joghurt", "milch", "milk"],
  household_paper: ["klopapier", "toilettenpapier", "wc papier", "haushaltspapier", "kuechenrolle", "taschentucher", "taschentuecher"],
  cleaning: ["putzmittel", "reinigungsmittel", "reiniger", "wc reiniger", "spulmittel", "spuelmittel"],
  fruit: ["banana", "bananas", "fruit", "obst"],
  pasta: ["pasta", "spaghetti", "penne"],
}

const CATEGORY_SIGNALS: Record<string, string[]> = mergeAcceptedAliasesIntoSignals(
  BASE_CATEGORY_SIGNALS,
)
