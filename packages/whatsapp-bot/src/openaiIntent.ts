type FetchLike = typeof fetch

export type ConversationIntent = {
  intent:
    | "recipe_request"
    | "add_to_basket"
    | "replace_item"
    | "remove_item"
    | "checkout"
    | "address_update"
    | "preferences_update"
    | "shipping_query"
    | "order_status"
    | "cancel"
    | "unknown"
  confidence: number
  replyMode: "answer" | "clarify"
  missingSlots: string[]
  extracted: {
    servings?: number
    dietary?: string[]
    productQuery?: string
    deliveryDate?: string
    addressHint?: string
    preferences?: string[]
  }
  assistantMessage?: string
}

export type CatalogQueryInterpretation = {
  normalizedQuery: string
  normalizedTerms: string[]
  categoryHints: string[]
  packagingHint?: string
  quantityHint?: number
  confidence: number
  shouldClarify: boolean
  clarificationQuestion?: string
}

export class OpenAIIntentClient {
  private readonly apiKey: string
  private readonly model: string
  private readonly fetchImpl: FetchLike

  constructor(args: { apiKey: string; model?: string; fetchImpl?: FetchLike }) {
    this.apiKey = args.apiKey.trim()
    this.model = args.model?.trim() || "gpt-4.1-mini"
    this.fetchImpl = args.fetchImpl || fetch
  }

  async interpret(args: { message: string; contextSummary?: string }): Promise<ConversationIntent> {
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
              "You classify grocery concierge messages.",
              "Return strict JSON only.",
              "Do not execute any action.",
              "Decide intent and missing information only.",
            ].join(" "),
          },
          {
            role: "user",
            content: [
              `Context summary: ${args.contextSummary || "none"}`,
              `Message: ${args.message}`,
              "Return JSON with keys: intent, confidence, replyMode, missingSlots, extracted, assistantMessage.",
            ].join("\n"),
          },
        ],
      }),
    })
    const body = await safeParseJson(response)
    if (!response.ok) {
      throw new Error(`openai_intent_http_${response.status}:${JSON.stringify(body).slice(0, 300)}`)
    }
    return normalizeIntent(extractResponseText(body))
  }

  async interpretCatalogQuery(args: {
    message: string
    contextSummary?: string
  }): Promise<CatalogQueryInterpretation> {
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
              "You normalize grocery and drinks requests into catalogue-search hints.",
              "Return strict JSON only.",
              "Do not choose products.",
              "Translate informal German or English shopping requests into grounded search terms.",
            ].join(" "),
          },
          {
            role: "user",
            content: [
              `Context summary: ${args.contextSummary || "none"}`,
              `Message: ${args.message}`,
              "Return JSON with keys: normalizedQuery, normalizedTerms, categoryHints, packagingHint, quantityHint, confidence, shouldClarify, clarificationQuestion.",
            ].join("\n"),
          },
        ],
      }),
    })
    const body = await safeParseJson(response)
    if (!response.ok) {
      throw new Error(`openai_catalog_query_http_${response.status}:${JSON.stringify(body).slice(0, 300)}`)
    }
    return normalizeCatalogQuery(extractResponseText(body), args.message)
  }
}

export function fallbackIntent(message: string): ConversationIntent {
  const text = message.toLowerCase()
  if (text.includes("status")) {
    return baseIntent("order_status")
  }
  if (text.includes("preference") || text.includes("bio") || text.includes("regional") || text.includes("cheap")) {
    return baseIntent("preferences_update")
  }
  if (text.includes("cancel")) {
    return baseIntent("cancel")
  }
  if (text.includes("checkout") || text.includes("pay")) {
    return {
      ...baseIntent("checkout"),
      replyMode: "clarify",
      missingSlots: ["confirmation"],
    }
  }
  return baseIntent("recipe_request")
}

export function fallbackCatalogQuery(message: string): CatalogQueryInterpretation {
  const normalizedQuery = normalizeLooseText(message)
  const normalizedTerms = Array.from(expandFallbackTerms(tokenizeLoose(normalizedQuery)))
  const categoryHints = inferFallbackCategoryHints(normalizedTerms)
  const packagingHint = inferFallbackPackagingHint(normalizedTerms)
  const quantityHint = inferFallbackQuantityHint(normalizedQuery)
  return {
    normalizedQuery,
    normalizedTerms,
    categoryHints,
    packagingHint,
    quantityHint,
    confidence: normalizedTerms.length ? 0.45 : 0.1,
    shouldClarify: !normalizedTerms.length,
    clarificationQuestion: !normalizedTerms.length
      ? "Was genau soll ich bei Alfies suchen?"
      : undefined,
  }
}

function baseIntent(intent: ConversationIntent["intent"]): ConversationIntent {
  return {
    intent,
    confidence: 0.5,
    replyMode: "answer",
    missingSlots: [],
    extracted: {},
  }
}

function extractResponseText(body: unknown): string {
  const record = body && typeof body === "object" ? (body as Record<string, unknown>) : {}
  if (typeof record.output_text === "string" && record.output_text.trim()) {
    return record.output_text.trim()
  }
  const output = Array.isArray(record.output) ? record.output : []
  const chunks: string[] = []
  for (const item of output) {
    const content = Array.isArray((item as Record<string, unknown>)?.content)
      ? ((item as Record<string, unknown>).content as Array<Record<string, unknown>>)
      : []
    for (const part of content) {
      if (typeof part.text === "string" && part.text.trim()) {
        chunks.push(part.text.trim())
      }
    }
  }
  return chunks.join("\n").trim()
}

function normalizeIntent(text: string): ConversationIntent {
  const raw = parseJson(text)
  return {
    intent: isIntent(raw.intent) ? raw.intent : "unknown",
    confidence: normalizeConfidence(raw.confidence),
    replyMode: raw.replyMode === "clarify" ? "clarify" : "answer",
    missingSlots: Array.isArray(raw.missingSlots) ? raw.missingSlots.map(String) : [],
    extracted: typeof raw.extracted === "object" && raw.extracted ? raw.extracted as ConversationIntent["extracted"] : {},
    assistantMessage: typeof raw.assistantMessage === "string" ? raw.assistantMessage : undefined,
  }
}

function normalizeCatalogQuery(text: string, fallbackMessage: string): CatalogQueryInterpretation {
  const raw = parseJson(text)
  const fallback = fallbackCatalogQuery(fallbackMessage)
  const normalizedTerms = Array.isArray(raw.normalizedTerms)
    ? Array.from(new Set(raw.normalizedTerms.map(String).map((term) => normalizeLooseText(term)).filter(Boolean)))
    : fallback.normalizedTerms
  const categoryHints = Array.isArray(raw.categoryHints)
    ? Array.from(new Set(raw.categoryHints.map(String).map((term) => normalizeLooseText(term)).filter(Boolean)))
    : fallback.categoryHints
  const packagingHint = typeof raw.packagingHint === "string" && raw.packagingHint.trim()
    ? normalizeLooseText(raw.packagingHint)
    : fallback.packagingHint
  const quantityHint = normalizePositiveInt(raw.quantityHint) ?? fallback.quantityHint
  return {
    normalizedQuery:
      typeof raw.normalizedQuery === "string" && raw.normalizedQuery.trim()
        ? normalizeLooseText(raw.normalizedQuery)
        : fallback.normalizedQuery,
    normalizedTerms,
    categoryHints,
    packagingHint,
    quantityHint,
    confidence: normalizeConfidence(raw.confidence) || fallback.confidence,
    shouldClarify: raw.shouldClarify === true,
    clarificationQuestion:
      typeof raw.clarificationQuestion === "string" && raw.clarificationQuestion.trim()
        ? raw.clarificationQuestion.trim()
        : raw.shouldClarify === true
          ? fallback.clarificationQuestion
          : undefined,
  }
}

function parseJson(text: string): Record<string, unknown> {
  try {
    return JSON.parse(text) as Record<string, unknown>
  } catch {
    const match = text.match(/\{[\s\S]*\}/)
    if (!match) throw new Error(`openai_intent_non_json:${text.slice(0, 300)}`)
    return JSON.parse(match[0]) as Record<string, unknown>
  }
}

function normalizeConfidence(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.max(0, Math.min(1, value))
  }
  return 0
}

function normalizePositiveInt(value: unknown): number | undefined {
  const parsed = Math.trunc(Number(value))
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined
}

function isIntent(value: unknown): value is ConversationIntent["intent"] {
  return typeof value === "string" && [
    "recipe_request",
    "add_to_basket",
    "replace_item",
    "remove_item",
    "checkout",
    "address_update",
    "preferences_update",
    "shipping_query",
    "order_status",
    "cancel",
    "unknown",
  ].includes(value)
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

function normalizeLooseText(value: string): string {
  return String(value || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\w\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

function tokenizeLoose(value: string): string[] {
  return normalizeLooseText(value)
    .split(" ")
    .map((part) => part.trim())
    .filter((part) => part.length >= 2 && !FALLBACK_STOPWORDS.has(part))
}

function expandFallbackTerms(tokens: string[]): Set<string> {
  const expanded = new Set<string>()
  for (const token of tokens) {
    expanded.add(token)
    const synonyms = FALLBACK_SYNONYMS[token]
    if (synonyms) {
      for (const synonym of synonyms) expanded.add(synonym)
    }
  }
  return expanded
}

function inferFallbackCategoryHints(tokens: string[]): string[] {
  const tokenSet = new Set(tokens)
  const hints: string[] = []
  if ([...tokenSet].some((token) => ["bier", "beer", "wein", "wine", "cola", "wasser", "juice"].includes(token))) {
    hints.push("drinks", "beer")
  }
  if ([...tokenSet].some((token) => ["chips", "snacks", "party"].includes(token))) {
    hints.push("snacks")
  }
  if ([...tokenSet].some((token) => ["pasta", "spaghetti", "penne"].includes(token))) {
    hints.push("pasta")
  }
  return Array.from(new Set(hints))
}

function inferFallbackPackagingHint(tokens: string[]): string | undefined {
  const tokenSet = new Set(tokens)
  if ([...tokenSet].some((token) => ["kiste", "kasten", "crate", "tray", "case", "bundle", "box"].includes(token))) {
    return "crate"
  }
  return undefined
}

function inferFallbackQuantityHint(message: string): number | undefined {
  const patterns = [/\bfor\s+(\d{1,2})\b/i, /\bfuer\s+(\d{1,2})\b/i, /\b(\d{1,2})x\b/i, /\bx(\d{1,2})\b/i]
  for (const pattern of patterns) {
    const match = pattern.exec(message)
    if (!match?.[1]) continue
    const parsed = normalizePositiveInt(match[1])
    if (parsed) return parsed
  }
  return undefined
}

const FALLBACK_STOPWORDS = new Set([
  "bitte",
  "die",
  "der",
  "das",
  "ein",
  "eine",
  "fuer",
  "for",
  "ich",
  "mit",
  "und",
])

const FALLBACK_SYNONYMS: Record<string, string[]> = {
  bier: ["beer", "helles", "maerzen", "lager"],
  beer: ["bier"],
  kiste: ["crate", "tray", "case", "bundle", "kasten"],
  kasten: ["crate", "tray", "case", "bundle", "kiste"],
  wein: ["wine"],
  wine: ["wein"],
}
