import type { ConversationReferenceItem, PendingOption, StoredAlfiesProduct } from "./stateStore.js"
import { mergeAcceptedAliasesIntoSignals } from "./trainingRuntimeConfig.js"

export function resolvePendingOptionSelection(
  message: string,
  pendingOptions: { options: PendingOption[] } | undefined,
): PendingOption | null {
  if (!pendingOptions?.options?.length) return null
  const normalized = normalize(message)
  const numeric = normalized.match(/^\d{1,2}$/)?.[0]
  if (numeric) {
    const index = Math.trunc(Number(numeric)) - 1
    return pendingOptions.options[index] || null
  }
  for (const option of pendingOptions.options) {
    if (normalized === normalize(option.label) || normalized === normalize(option.value) || normalized === normalize(option.id)) {
      return option
    }
  }
  return null
}

export function buildProductSelectionOptions(args: {
  query: string
  products: StoredAlfiesProduct[]
  limit?: number
  offset?: number
}): PendingOption[] {
  const normalizedQuery = normalize(args.query)
  return args.products
    .map((product) => ({
      product,
      score: overlapScore(normalizedQuery, normalize([product.title, product.category, ...product.keywords].join(" "))),
    }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || (a.product.price_cents || 0) - (b.product.price_cents || 0))
    .slice(args.offset || 0, (args.offset || 0) + (args.limit || 5))
    .map((entry, index) => ({
      id: `product_${(args.offset || 0) + index + 1}`,
      label: entry.product.title,
      value: entry.product.title,
      productId: entry.product.product_id,
      sku: entry.product.slug,
      unitPriceCents: entry.product.price_cents,
      currency: entry.product.currency,
    }))
}

export function buildCategorySelectionOptions(products: StoredAlfiesProduct[], limit = 8, offset = 0): PendingOption[] {
  const byCategory = new Map<string, number>()
  for (const product of products) {
    const category = String(product.category || "").trim()
    if (!category) continue
    byCategory.set(category, (byCategory.get(category) || 0) + 1)
  }
  return [...byCategory.entries()]
    .sort((a, b) =>
      compareCategoryPriority(a[0], b[0]) ||
      b[1] - a[1] ||
      a[0].localeCompare(b[0]),
    )
    .slice(offset, offset + limit)
    .map(([category], index) => ({
      id: `category_${offset + index + 1}`,
      label: category,
      value: category,
    }))
}

export function buildMatchingCategoryOptions(args: {
  query: string
  products: StoredAlfiesProduct[]
  limit?: number
  offset?: number
}): PendingOption[] {
  const normalizedQuery = normalizeCategoryQuery(args.query)
  const categories = buildCategorySelectionOptions(args.products, 100)
  return categories
    .map((option) => ({
      option,
      score: categoryScore(normalizedQuery, normalize(option.label)),
    }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.option.label.localeCompare(b.option.label))
    .slice(args.offset || 0, (args.offset || 0) + (args.limit || 6))
    .map((entry) => entry.option)
}

export function buildProductsForCategoryOptions(args: {
  category: string
  products: StoredAlfiesProduct[]
  limit?: number
  offset?: number
}): PendingOption[] {
  const category = normalize(args.category)
  return args.products
    .filter((product) => normalize(String(product.category || "")) === category)
    .sort((a, b) => (a.price_cents || Number.MAX_SAFE_INTEGER) - (b.price_cents || Number.MAX_SAFE_INTEGER) || a.title.localeCompare(b.title))
    .slice(args.offset || 0, (args.offset || 0) + (args.limit || 8))
    .map((product, index) => ({
      id: `product_${(args.offset || 0) + index + 1}`,
      label: product.title,
      value: product.title,
      productId: product.product_id,
      sku: product.slug,
      unitPriceCents: product.price_cents,
      currency: product.currency,
    }))
}

export function buildReferenceSelectionOptions(
  products: ConversationReferenceItem[],
  limit = 6,
): PendingOption[] {
  return products
    .filter((product) => product.title.trim())
    .slice(0, limit)
    .map((product, index) => ({
      id: `product_${index + 1}`,
      label: product.title,
      value: product.title,
      productId: product.productId,
      sku: product.sku,
    }))
}

export function buildOccasionSelectionOptions(): PendingOption[] {
  return [
    { id: "occasion_1", label: "Getraenke", value: "drinks" },
    { id: "occasion_2", label: "Snacks", value: "snacks" },
    { id: "occasion_3", label: "Beides", value: "both" },
  ]
}

export function formatPendingOptionsMessage(prompt: string, options: PendingOption[]): string {
  return [
    prompt,
    "",
    ...options.map((option, index) => `${index + 1}. ${option.label}`),
    "",
    "Antworte mit der Nummer oder dem Namen.",
    "Fuer weitere Treffer: 'mehr' oder 'mehr Kategorien'.",
  ].join("\n")
}

export function buildCartItemSelectionOptions(cart: { items?: unknown[] } | undefined): PendingOption[] {
  const items = Array.isArray(cart?.items) ? cart.items : []
  return items
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
    .map((item, index) => ({
      id: `cart_item_${index + 1}`,
      label: `${String(item.name || item.title || "Artikel")} (${Math.trunc(Number(item.qty || 1))}x)`,
      value: String(item.name || item.title || `item_${index + 1}`),
      productId: typeof item.product_id === "number" ? Math.trunc(item.product_id) : undefined,
      sku: typeof item.sku === "string" ? item.sku : undefined,
      unitPriceCents: typeof item.unit_price_cents === "number" ? Math.trunc(item.unit_price_cents) : undefined,
      currency: typeof item.currency === "string" ? item.currency : undefined,
    }))
}

export function buildCartItemActionOptions(itemLabel: string, item: PendingOption): PendingOption[] {
  return [
    { id: "cart_action_1", label: `Mehr von ${itemLabel}`, value: "mehr", action: "increase", productId: item.productId, sku: item.sku, unitPriceCents: item.unitPriceCents, currency: item.currency },
    { id: "cart_action_2", label: `Menge aendern`, value: "menge", action: "set_quantity", productId: item.productId, sku: item.sku, unitPriceCents: item.unitPriceCents, currency: item.currency },
    { id: "cart_action_3", label: `Nur dieses behalten`, value: "nur dieses", action: "only", productId: item.productId, sku: item.sku, unitPriceCents: item.unitPriceCents, currency: item.currency },
    { id: "cart_action_4", label: `Entfernen`, value: "entfernen", action: "remove", productId: item.productId, sku: item.sku, unitPriceCents: item.unitPriceCents, currency: item.currency },
  ]
}

export function extractInlineChoiceOptions(prompt: string, limit = 6): PendingOption[] {
  const raw = String(prompt || "").trim()
  if (!raw) return []

  if (looksLikeBinaryConfirmation(raw)) {
    return [
      { id: "inline_option_1", label: "Ja", value: "ja" },
      { id: "inline_option_2", label: "Nein", value: "nein" },
    ]
  }

  const explicitSegment = raw.match(/\b(?:wie|zum beispiel|z\.?\s*b\.?)\s+(.+?)(?:\?|\.|$)/i)?.[1]
    || raw.match(/:\s*(.+?)(?:\?|\.|$)/)?.[1]
  if (!explicitSegment && looksLikeGenericOpenQuestion(raw)) {
    return []
  }
  const candidateText = explicitSegment || raw
  const cleaned = candidateText
    .replace(/\b(bitten?|oder etwas anderes|aus einer bestimmten kategorie|meinen sie|moechten sie|möchten sie|welche)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim()

  if (!cleaned || cleaned.split(/[,\u00b7]/).length < 2 && !/\boder\b/i.test(cleaned)) {
    return []
  }

  const parts = cleaned
    .replace(/\s+oder\s+/gi, ",")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => part.replace(/^[\s-]+|[\s-]+$/g, ""))
    .filter((part) => part.length >= 3)

  const unique = [...new Set(parts)]
  if (unique.length < 2) return []

  return unique.slice(0, limit).map((label, index) => ({
    id: `inline_option_${index + 1}`,
    label,
    value: label,
  }))
}

function overlapScore(left: string, right: string): number {
  const leftTokens = new Set(left.split(" ").filter(Boolean))
  const rightTokens = new Set(right.split(" ").filter(Boolean))
  let score = 0
  for (const token of leftTokens) {
    if (rightTokens.has(token)) score += 1
  }
  return score
}

function categoryScore(query: string, category: string): number {
  const queryTokens = new Set(query.split(" ").filter(Boolean))
  const categoryTokens = new Set(category.split(" ").filter(Boolean))
  let score = 0
  for (const token of queryTokens) {
    if (categoryTokens.has(token)) score += 2
  }
  if (query.includes("milch") && ["milch alternativen", "joghurt", "kaese", "butter"].some((token) => category.includes(token))) {
    score += 2
  }
  if (query.includes("milchprodukte") || query.includes("milk products")) {
    if (["milch", "joghurt", "kaese", "butter", "quark"].some((token) => category.includes(token))) {
      score += 3
    }
  }
  if ((query.includes("fleisch") || query.includes("meat")) && ["fleisch", "rind", "gefluegel", "huhn", "wurst", "schwein", "lamm", "bbq"].some((token) => category.includes(token))) {
    score += 3
  }
  if ((query.includes("spirituosen") || query.includes("spirits")) && ["spirit", "whisky", "gin", "rum", "vodka", "tequila", "likor", "liqueur", "aperitif"].some((token) => category.includes(token))) {
    score += 3
  }
  if ((query.includes("wein") || query.includes("wine")) && ["wein", "rotwein", "weisswein", "rose", "prosecco", "sekt", "champagner"].some((token) => category.includes(token))) {
    score += 3
  }
  if ((query.includes("bier") || query.includes("beer")) && ["bier", "helles", "maerzen", "maerzen", "weizen", "pils", "cider"].some((token) => category.includes(token))) {
    score += 3
  }
  if ((query.includes("alkoholfrei") || query.includes("softdrinks") || query.includes("soft drinks")) && ["limo", "softdrink", "eistee", "cola", "wasser", "saft", "energy"].some((token) => category.includes(token))) {
    score += 3
  }
  if ((query.includes("party") || query.includes("feiern")) && ["getranke", "drinks", "snacks", "chips", "bier", "wein"].some((token) => category.includes(token))) {
    score += 2
  }
  if (query.includes("klopapier")) {
    if (category.includes("toilettenpapier")) score += 4
    if (category.includes("haushaltspapier")) score += 1
  }
  if (query.includes("toilettenpapier") && category.includes("toilettenpapier")) {
    score += 4
  }
  if ((query.includes("haushaltspapier") || query.includes("kuechenrolle")) && category.includes("haushaltspapier")) {
    score += 4
  }
  for (const [family, signals] of Object.entries(CATEGORY_FAMILY_SIGNALS)) {
    if (signals.some((signal) => query.includes(signal)) && categoryMatchesFamily(category, family)) {
      score += 5
    }
  }
  return score
}

function normalizeCategoryQuery(value: string): string {
  return normalize(value)
    .replace(/\b(ich mochte|ich möchte|ich will|auch|zusatzlich|zusätzlich|noch|kaufen|zeige mir|alle|produkte|producte|browse|durchsuche)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

function compareCategoryPriority(left: string, right: string): number {
  return categoryPriority(normalize(left)) - categoryPriority(normalize(right))
}

function categoryPriority(category: string): number {
  const normalized = normalize(category)
  for (const [index, entry] of PRIORITY_CATEGORY_FAMILIES.entries()) {
    if (categoryMatchesFamily(normalized, entry)) {
      return index
    }
  }
  return PRIORITY_CATEGORY_FAMILIES.length + 100
}

function categoryMatchesFamily(category: string, family: string): boolean {
  return CATEGORY_FAMILY_SIGNALS[family]?.some((signal) => category.includes(signal)) || false
}

function looksLikeBinaryConfirmation(value: string): boolean {
  const normalized = normalize(value)
  return /^(meinen sie|meinst du|ist das|soll ich|soll das|meinst du eher)\b/.test(normalized)
}

function looksLikeGenericOpenQuestion(value: string): boolean {
  const normalized = normalize(value)
  return /^(was|welche|welcher|welches|womit|worauf|wofuer|wofür)\b/.test(normalized)
}

function normalize(value: string): string {
  return String(value || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\w\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

const PRIORITY_CATEGORY_FAMILIES = [
  "kaese",
  "fleisch",
  "getraenke",
  "toilettenpapier",
  "putzmittel",
  "brot",
  "milchprodukte",
  "brotaufstriche",
  "konserven",
  "fruehstuck",
  "gemuese",
  "wurst",
  "schinken_speck",
  "pasta",
  "reis",
  "feinkost_antipasti",
  "backen",
  "koerperpflege",
  "muesli",
  "haustier",
  "baby",
] as const

const BASE_CATEGORY_FAMILY_SIGNALS: Record<string, string[]> = {
  kaese: ["kaese", "frischkaese", "mozzarella", "parmesan", "feta", "cheese"],
  fleisch: ["fleisch", "rind", "schwein", "huhn", "gefluegel", "lamm", "meat"],
  getraenke: ["getrank", "getranke", "drinks", "beer", "bier", "wein", "wine", "saft", "wasser"],
  toilettenpapier: ["klopapier", "toilettenpapier", "wc papier", "haushaltspapier", "kuechenrolle", "taschentuch", "papier"],
  putzmittel: ["putz", "reinigung", "wc", "haushalt", "clean", "reiniger"],
  brot: ["brot", "bread", "backwaren", "broetchen", "brotchen"],
  milchprodukte: ["milch", "joghurt", "butter", "quark", "dairy", "milchprodukte"],
  brotaufstriche: ["aufstrich", "brotaufstrich", "marmelade", "honig", "creme"],
  konserven: ["konserve", "konserven", "dose", "canned"],
  fruehstuck: ["fruehstuck", "fruhstuck", "breakfast"],
  gemuese: ["gemuese", "vegetable", "veg", "salat"],
  wurst: ["wurst", "sausage"],
  schinken_speck: ["schinken", "speck", "ham", "bacon"],
  pasta: ["pasta", "spaghetti", "penne", "nudel", "noodle"],
  reis: ["reis", "rice"],
  feinkost_antipasti: ["feinkost", "antipasti", "oliven", "deli"],
  backen: ["backen", "baking", "mehl", "zucker"],
  koerperpflege: ["koerperpflege", "korperpflege", "shampoo", "zahnpasta", "seife", "pflege"],
  muesli: ["muesli", "musli", "granola", "cereal"],
  haustier: ["haustier", "pet", "cat", "dog", "tier"],
  baby: ["baby", "windel", "nahrung"],
}

const CATEGORY_FAMILY_SIGNALS: Record<string, string[]> = mergeAcceptedAliasesIntoSignals(
  BASE_CATEGORY_FAMILY_SIGNALS,
)
