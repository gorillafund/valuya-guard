import type { ShoppingPreferences, StoredAlfiesProduct } from "./stateStore.js"
import type { CatalogQueryInterpretation } from "./openaiIntent.js"
import type { ResolvedRecipeRequest } from "./recipeService.js"

export type AlfiesResolvedLine = {
  id: number
  quantity: number
}

export type AlfiesProductRule = {
  label?: string
  match: string[]
  products: AlfiesResolvedLine[]
}

export function parseResolverRules(raw: string | undefined): AlfiesProductRule[] {
  const text = String(raw || "").trim()
  if (!text) return []
  const parsed = JSON.parse(text) as unknown
  if (!Array.isArray(parsed)) throw new Error("alfies_product_map_invalid")
  return parsed
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
    .map((item) => ({
      label: typeof item.label === "string" ? item.label : undefined,
      match: Array.isArray(item.match) ? item.match.map(String).map((v) => v.trim()).filter(Boolean) : [],
      products: Array.isArray(item.products)
        ? item.products
            .filter((line): line is Record<string, unknown> => Boolean(line) && typeof line === "object")
            .map((line) => ({
              id: Math.trunc(Number(line.id || 0)),
              quantity: Math.max(1, Math.trunc(Number(line.quantity || 1))),
            }))
            .filter((line) => line.id > 0)
        : [],
    }))
    .filter((rule) => rule.match.length > 0 && rule.products.length > 0)
}

export function resolveProductsFromMessage(
  message: string,
  rules: AlfiesProductRule[],
): { lines: AlfiesResolvedLine[]; label?: string } | null {
  const normalized = normalize(message)
  for (const rule of rules) {
    if (rule.match.some((keyword) => normalized.includes(normalize(keyword)))) {
      return {
        lines: rule.products,
        label: rule.label,
      }
    }
  }
  return null
}

export function resolveProductsFromCatalog(
  message: string,
  products: StoredAlfiesProduct[],
  preferences?: ShoppingPreferences,
  interpretedQuery?: CatalogQueryInterpretation,
  recipeRequest?: ResolvedRecipeRequest | null,
): { lines: AlfiesResolvedLine[]; label?: string } | null {
  const normalized = normalize(message)
  const interpretedTokens = interpretedQuery
    ? [
        interpretedQuery.normalizedQuery,
        ...interpretedQuery.normalizedTerms,
        ...interpretedQuery.categoryHints,
        interpretedQuery.packagingHint || "",
      ]
    : []
  const messageTokens = expandMessageTokens([
    ...tokenize(normalized),
    ...interpretedTokens.flatMap((value) => tokenize(String(value || ""))),
  ])
  if (!messageTokens.size) return null
  const servingHint = interpretedQuery?.quantityHint || extractServingHint(normalized)
  const requestCategories = inferRequestCategories(messageTokens, interpretedQuery?.categoryHints)

  const scored = products
    .map((product) => {
      const productTokens = buildProductTokens(product)
      const categoryTokens = tokenize(String(product.category || ""))
      const directOverlap = productTokens.filter((token) => messageTokens.has(token))
      const categoryOverlap = categoryTokens.filter((token) => requestCategories.has(token))
      return {
        product,
        directOverlap,
        categoryOverlap,
        preferenceBoost: computePreferenceBoost(product, preferences),
        score: directOverlap.length * 5 + categoryOverlap.length * 2,
      }
    })
    .filter((entry) => entry.score > 0)
    .sort((left, right) =>
      (right.score + right.preferenceBoost) - (left.score + left.preferenceBoost) ||
      right.preferenceBoost - left.preferenceBoost ||
      right.directOverlap.length - left.directOverlap.length ||
      right.categoryOverlap.length - left.categoryOverlap.length ||
      comparePrice(left.product, right.product, preferences) ||
      left.product.title.localeCompare(right.product.title),
    )
    .slice(0, 4)

  if (!scored.length) return null
  if (recipeRequest && !passesRecipeQualityGate(scored, recipeRequest)) return null

  return {
    lines: scored.map(({ product }) => ({
      id: product.product_id,
      quantity: inferLineQuantity(product, servingHint, messageTokens),
    })),
    label: buildCatalogLabel(servingHint, preferences),
  }
}

export function explainCatalogMiss(
  message: string,
  products: StoredAlfiesProduct[],
  interpretedQuery?: CatalogQueryInterpretation,
): string {
  if (interpretedQuery?.shouldClarify && interpretedQuery.clarificationQuestion) {
    return interpretedQuery.clarificationQuestion
  }
  const messageTokens = expandMessageTokens([
    ...tokenize(message),
    ...(interpretedQuery?.normalizedTerms || []),
    ...(interpretedQuery?.categoryHints || []),
    ...(interpretedQuery?.packagingHint ? [interpretedQuery.packagingHint] : []),
  ])
  const suggestions = inferSuggestionCategories(messageTokens, products)
  const quoted = `'${message.trim()}'`
  if (!suggestions.length) {
    return [
      `Ich habe im Alfies-Katalog nichts Passendes fuer ${quoted} gefunden.`,
      "Beschreibe es etwas genauer oder nenne eine Alternative, zum Beispiel 'helles bier', 'chips' oder 'pasta fuer 2'.",
    ].join("\n")
  }
  return [
    `Ich habe im Alfies-Katalog nichts Passendes fuer ${quoted} gefunden.`,
    `Am ehesten koennte ich stattdessen in ${suggestions.join(", ")} suchen.`,
    "Wenn du magst, formuliere den Wunsch etwas konkreter.",
  ].join("\n")
}

export function findAlternativesForCartItems(args: {
  cart: { items?: unknown[] }
  products: StoredAlfiesProduct[]
  preferences?: ShoppingPreferences
}): {
  items: Array<{
    originalName: string
    alternative: StoredAlfiesProduct
    quantity: number
  }>
} {
  const cartItems = Array.isArray(args.cart?.items) ? args.cart.items : []
  const alternatives = cartItems
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
    .map((item) => {
      const originalName = String(item.name || item.title || "").trim()
      const originalSku = typeof item.sku === "string" ? item.sku : undefined
      const originalProductId = typeof item.product_id === "number" ? Math.trunc(item.product_id) : undefined
      const quantity = Math.max(1, Math.trunc(Number(item.qty || 1)))
      if (!originalName) return null
      const tokens = new Set(tokenize([originalName].join(" ")))
      const candidates = args.products
        .filter((product) =>
          product.product_id !== originalProductId &&
          (!originalSku || product.slug !== originalSku),
        )
        .map((product) => {
          const productTokens = buildProductTokens(product)
          const overlap = productTokens.filter((token) => tokens.has(token)).length
          const categoryMatch = normalize(String(product.category || "")) === normalize(String(item.category || "")) ? 2 : 0
          const preferenceBoost = computePreferenceBoost(product, args.preferences)
          return {
            product,
            score: overlap * 5 + categoryMatch + preferenceBoost,
          }
        })
        .filter((entry) => entry.score > 0)
        .sort((a, b) =>
          b.score - a.score ||
          comparePrice(a.product, b.product, args.preferences) ||
          a.product.title.localeCompare(b.product.title),
        )
      const best = candidates[0]?.product
      return best
        ? {
            originalName,
            alternative: best,
            quantity,
          }
        : null
    })
    .filter((entry): entry is { originalName: string; alternative: StoredAlfiesProduct; quantity: number } => Boolean(entry))

  return { items: alternatives }
}

function normalize(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

function tokenize(value: string): string[] {
  return normalize(value)
    .split(" ")
    .map((part) => part.trim())
    .filter((part) => part.length >= 3 && !STOPWORDS.has(part))
}

function buildProductTokens(product: StoredAlfiesProduct): string[] {
  const sources = [
    product.title,
    product.slug,
    product.category,
    ...product.keywords,
  ]
  return [...new Set(expandMessageTokens(sources.flatMap((value) => tokenize(String(value || "")))))]
}

function extractServingHint(message: string): number {
  const patterns = [
    /\bfor\s+(\d{1,2})\b/i,
    /\bfuer\s+(\d{1,2})\b/i,
    /\bfur\s+(\d{1,2})\b/i,
    /\b(\d{1,2})x\b/i,
    /\bx(\d{1,2})\b/i,
  ]
  for (const pattern of patterns) {
    const match = pattern.exec(message)
    if (!match?.[1]) continue
    const parsed = Math.trunc(Number(match[1]))
    if (Number.isFinite(parsed) && parsed > 0) {
      return Math.min(parsed, 6)
    }
  }
  return 1
}

function inferRequestCategories(messageTokens: Set<string>, hintedCategories?: string[]): Set<string> {
  const categories = new Set<string>()
  for (const hinted of hintedCategories || []) {
    const normalized = normalize(hinted)
    if (normalized) categories.add(normalized)
  }
  for (const [category, signals] of Object.entries(CATEGORY_SIGNALS)) {
    if (signals.some((signal) => messageTokens.has(signal))) {
      categories.add(category)
    }
  }
  return categories
}

function inferLineQuantity(
  product: StoredAlfiesProduct,
  servingHint: number,
  messageTokens: Set<string>,
): number {
  const category = normalize(String(product.category || ""))
  const productTokens = new Set(buildProductTokens(product))
  if (servingHint <= 1) return 1

  if (isDrinksCategory(category, productTokens, messageTokens)) {
    return Math.min(servingHint, 4)
  }

  if (isShareCategory(category, productTokens, messageTokens)) {
    return Math.min(Math.max(1, Math.ceil(servingHint / 2)), 3)
  }

  return servingHint >= 4 ? 2 : 1
}

function computePreferenceBoost(
  product: StoredAlfiesProduct,
  preferences: ShoppingPreferences | undefined,
): number {
  if (!preferences) return 0
  let score = 0
  const keywordSet = new Set(buildProductTokens(product))

  if (preferences.bio && matchesAny(keywordSet, BIO_SIGNALS)) {
    score += 4
  }
  if (preferences.regional && matchesAny(keywordSet, REGIONAL_SIGNALS)) {
    score += 3
  }
  return score
}

function comparePrice(
  left: StoredAlfiesProduct,
  right: StoredAlfiesProduct,
  preferences: ShoppingPreferences | undefined,
): number {
  if (!preferences?.cheapest) {
    return (left.price_cents ?? Number.MAX_SAFE_INTEGER) - (right.price_cents ?? Number.MAX_SAFE_INTEGER)
  }
  return (left.price_cents ?? Number.MAX_SAFE_INTEGER) - (right.price_cents ?? Number.MAX_SAFE_INTEGER)
}

function buildCatalogLabel(servingHint: number, preferences: ShoppingPreferences | undefined): string {
  const active = [
    preferences?.cheapest ? "cheapest" : null,
    preferences?.regional ? "regional" : null,
    preferences?.bio ? "bio" : null,
  ].filter(Boolean)
  const base = servingHint > 1 ? `Indexed Alfies catalog for ${servingHint}` : "Indexed Alfies catalog"
  return active.length ? `${base} (${active.join(", ")})` : base
}

function matchesAny(values: Set<string>, signals: Set<string>): boolean {
  return [...values].some((value) => signals.has(value))
}

function expandMessageTokens(tokens: Iterable<string>): Set<string> {
  const expanded = new Set<string>()
  for (const token of tokens) {
    const normalized = normalize(token)
    if (!normalized) continue
    expanded.add(normalized)
    const synonyms = TOKEN_SYNONYMS[normalized]
    if (synonyms) {
      for (const synonym of synonyms) expanded.add(synonym)
    }
  }
  return expanded
}

function inferSuggestionCategories(messageTokens: Set<string>, products: StoredAlfiesProduct[]): string[] {
  const wanted = inferRequestCategories(messageTokens)
  const suggestions = new Set<string>()

  for (const product of products) {
    const category = String(product.category || "").trim()
    if (!category) continue
    const categoryTokens = expandMessageTokens(tokenize(category))
    if ([...messageTokens].some((token) => categoryTokens.has(token))) {
      suggestions.add(category)
    }
    if (wanted.size && [...wanted].some((token) => categoryTokens.has(token))) {
      suggestions.add(category)
    }
    if (suggestions.size >= 3) break
  }

  if (!suggestions.size) {
    if (messageTokens.has("beer")) {
      suggestions.add("Helles & Maerzen")
      suggestions.add("Bier Spezialitaeten")
    }
    if (messageTokens.has("wine")) {
      suggestions.add("Weissweine")
      suggestions.add("Rotweine")
    }
    if (messageTokens.has("chips") || messageTokens.has("snacks")) {
      suggestions.add("Chips & Flips")
    }
  }

  return [...suggestions].slice(0, 3)
}

function passesRecipeQualityGate(
  scored: Array<{
    product: StoredAlfiesProduct
    directOverlap: string[]
    categoryOverlap: string[]
    preferenceBoost: number
    score: number
  }>,
  recipeRequest: ResolvedRecipeRequest,
): boolean {
  const matchedTokens = new Set<string>()
  for (const entry of scored) {
    for (const token of buildProductTokens(entry.product)) matchedTokens.add(token)
  }
  const anchorHits = recipeRequest.requiredAnchors.filter((anchor) => matchedTokens.has(normalize(anchor))).length
  if (anchorHits < Math.min(2, recipeRequest.requiredAnchors.length)) return false
  if (scored.some((entry) => isForbiddenRecipeCategory(entry.product.category))) return false
  return true
}

function isForbiddenRecipeCategory(category: string | undefined): boolean {
  const normalized = normalize(String(category || ""))
  return FORBIDDEN_RECIPE_CATEGORY_SIGNALS.some((signal) => normalized.includes(signal))
}

function isDrinksCategory(category: string, productTokens: Set<string>, messageTokens: Set<string>): boolean {
  if (category.includes("drink") || category.includes("beverage")) return true
  if (category.includes("beer") || category.includes("wine")) return true
  return [...productTokens, ...messageTokens].some((token) => DRINK_SIGNALS.has(token))
}

function isShareCategory(category: string, productTokens: Set<string>, messageTokens: Set<string>): boolean {
  if (category.includes("snack")) return true
  return [...productTokens, ...messageTokens].some((token) => SHARE_SIGNALS.has(token))
}

const STOPWORDS = new Set([
  "and",
  "oder",
  "with",
  "fuer",
  "fur",
  "for",
  "mit",
  "the",
  "und",
])

const DRINK_SIGNALS = new Set([
  "drink",
  "drinks",
  "beverage",
  "beverages",
  "beer",
  "wine",
  "cola",
  "juice",
  "wasser",
  "water",
])

const SHARE_SIGNALS = new Set([
  "snack",
  "snacks",
  "chips",
  "party",
  "movie",
  "night",
])

const BIO_SIGNALS = new Set([
  "bio",
  "organic",
  "demeter",
  "natur",
])

const REGIONAL_SIGNALS = new Set([
  "at",
  "austria",
  "oesterreich",
  "osterreich",
  "regional",
  "lokal",
  "local",
])

const CATEGORY_SIGNALS: Record<string, string[]> = {
  pasta: ["pasta", "spaghetti", "penne", "noodles"],
  snacks: ["snack", "snacks", "chips", "party", "movie"],
  drinks: ["drink", "drinks", "beer", "bier", "wine", "juice", "water", "cola"],
  breakfast: ["breakfast", "brot", "bread", "eggs", "muesli"],
  sauces: ["sauce", "tomato", "pesto", "dip"],
}

const TOKEN_SYNONYMS: Record<string, string[]> = {
  bier: ["beer", "beers", "helles", "maerzen", "lager"],
  beer: ["bier"],
  kiste: ["kiste", "crate", "tray", "case", "bundle", "kasten"],
  kasten: ["kiste", "crate", "tray", "case", "bundle"],
  crate: ["kiste", "tray", "case", "bundle"],
  tray: ["kiste", "crate", "case", "bundle"],
  case: ["kiste", "crate", "tray", "bundle"],
  bundle: ["kiste", "crate", "tray", "case"],
  wine: ["wein"],
  wein: ["wine"],
  chips: ["snacks"],
  snack: ["chips"],
}

const FORBIDDEN_RECIPE_CATEGORY_SIGNALS = [
  "putz",
  "reinigung",
  "haushalt",
  "koerperpflege",
  "korperpflege",
  "baby",
  "haustier",
  "pet",
]
