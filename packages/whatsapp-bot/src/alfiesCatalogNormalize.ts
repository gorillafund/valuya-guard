import { readFile, writeFile } from "node:fs/promises"
import { resolve } from "node:path"
import type { StoredAlfiesProduct } from "./stateStore.js"

export function normalizeAlfiesCatalogText(text: string): Array<Omit<StoredAlfiesProduct, "updated_at">> {
  const parsed = parseCatalogDocuments(text)
  return normalizeAlfiesCatalog(parsed)
}

export function normalizeAlfiesCatalog(input: unknown): Array<Omit<StoredAlfiesProduct, "updated_at">> {
  const products = extractProductRecords(input)
  if (!products.length) {
    throw new Error("alfies_catalog_json_array_required")
  }

  return products
    .map(normalizeImportedProduct)
    .filter((product): product is Omit<StoredAlfiesProduct, "updated_at"> => Boolean(product))
}

export function normalizeImportedProduct(input: unknown): Omit<StoredAlfiesProduct, "updated_at"> | null {
  const value = input && typeof input === "object" ? (input as Record<string, unknown>) : null
  if (!value) return null

  const productId = Math.trunc(Number(value.product_id || value.id || 0))
  const title = cleanText(String(value.title || value.productTitle || value.name || ""))
  if (!productId || !title) return null

  const slug = cleanText(String(value.slug || ""))
  const category = normalizeCategory(value)
  const currency = normalizeCurrency(value.priceCurrency || value.currency || readWarehouseCurrency(value))
  const priceCents = normalizePriceCents(value)
  const keywords = buildKeywords(value, { title, slug, category })
  const availability = normalizeAvailability(value)

  return {
    product_id: productId,
    slug: slug || undefined,
    title,
    price_cents: priceCents,
    currency,
    keywords,
    category: category || undefined,
    availability_json: availability,
  }
}

async function main(): Promise<void> {
  const inputPathArg = process.argv[2]
  if (!inputPathArg) {
    throw new Error("alfies_catalog_json_path_required")
  }

  const outputPathArg = process.argv[3]
  const inputPath = resolve(process.cwd(), inputPathArg)
  const raw = await readFile(inputPath, "utf8")
  const normalized = normalizeAlfiesCatalogText(raw)
  const output = JSON.stringify(normalized, null, 2)

  if (outputPathArg) {
    await writeFile(resolve(process.cwd(), outputPathArg), `${output}\n`, "utf8")
    console.log(JSON.stringify({
      level: "info",
      event: "alfies_catalog_normalized",
      inputPath,
      outputPath: resolve(process.cwd(), outputPathArg),
      normalized_products: normalized.length,
    }))
    return
  }

  process.stdout.write(`${output}\n`)
}

function cleanText(value: string): string {
  return value.replace(/\s+/g, " ").trim()
}

function normalizeCurrency(value: unknown): string | undefined {
  const currency = cleanText(String(value || "")).toUpperCase()
  return currency || undefined
}

function normalizePriceCents(value: Record<string, unknown>): number | undefined {
  if (value.price_cents !== undefined && value.price_cents !== null && value.price_cents !== "") {
    const cents = Math.trunc(Number(value.price_cents))
    return Number.isFinite(cents) ? cents : undefined
  }

  const warehousePrice = readWarehousePrice(value)
  const price = value.price ?? value.price_incl_tax ?? value.priceInclTax ?? warehousePrice
  if (price === undefined || price === null || price === "") return undefined
  const numeric = Number(price)
  if (!Number.isFinite(numeric)) return undefined
  if (numeric >= 1000) return Math.trunc(numeric)
  return Math.round(numeric * 100)
}

function buildKeywords(
  value: Record<string, unknown>,
  base: { title: string; slug: string; category: string },
): string[] {
  const keywords = new Set<string>()
  const addTokens = (input: string) => {
    for (const token of tokenize(input)) {
      if (token.length >= 3) keywords.add(token)
    }
  }

  addTokens(base.title)
  addTokens(base.slug)
  addTokens(base.category)
  addTokens(cleanText(String(value.brand || "")))
  addTokens(cleanText(String(value.productTitle || "")))
  addTokens(cleanText(String(value.description || "")))
  addTokens(cleanText(String(value.unitBundleName || "")))
  addTokens(cleanText(String(value.displayUnit || "")))
  addTokens(cleanText(String(value.unitName || "")))
  addTokens(cleanText(String(value.structure || "")))

  const attributes = value.attributes && typeof value.attributes === "object"
    ? (value.attributes as Record<string, unknown>)
    : null
  if (attributes) {
    addTokens(cleanText(String(attributes.brand || "")))
    addTokens(cleanText(String(attributes.focusKeyword || "")))
    addTokens(cleanText(String(attributes.country || "")))
    if (Array.isArray(attributes.searchTags)) {
      for (const entry of attributes.searchTags) addTokens(String(entry || ""))
    }
    if (Array.isArray(attributes.nutritionType)) {
      for (const entry of attributes.nutritionType) addTokens(String(entry || ""))
    }
  }

  if (Array.isArray(value.keywords)) {
    for (const entry of value.keywords) addTokens(String(entry || ""))
  }
  if (Array.isArray(value.tags)) {
    for (const entry of value.tags) addTokens(String(entry || ""))
  }
  if (Array.isArray(value.categories)) {
    for (const entry of value.categories) {
      const category = entry && typeof entry === "object" ? (entry as Record<string, unknown>) : null
      if (!category) continue
      addTokens(cleanText(String(category.slug || "")))
      addTokens(cleanText(String(category.name || "")))
      addTokens(cleanText(String(category.parentSlug || "")))
      if (Array.isArray(category.path)) {
        for (const pathEntry of category.path) {
          const node = pathEntry && typeof pathEntry === "object" ? (pathEntry as Record<string, unknown>) : null
          if (!node) continue
          addTokens(cleanText(String(node.slug || "")))
          addTokens(cleanText(String(node.name || "")))
        }
      }
    }
  }

  return [...keywords].sort((left, right) => left.localeCompare(right))
}

function normalizeAvailability(value: Record<string, unknown>): Record<string, unknown> | undefined {
  if (value.availability && typeof value.availability === "object" && !Array.isArray(value.availability)) {
    return value.availability as Record<string, unknown>
  }
  if (value.availability_json && typeof value.availability_json === "object" && !Array.isArray(value.availability_json)) {
    return value.availability_json as Record<string, unknown>
  }

  if (typeof value.available === "boolean") {
    return { available: value.available }
  }

  const warehouseAvailability = readWarehouseAvailability(value)
  if (warehouseAvailability) {
    return warehouseAvailability
  }

  return undefined
}

function normalizeCategory(value: Record<string, unknown>): string {
  const direct = cleanText(String(value.category || value.category_name || ""))
  if (direct) return direct
  if (!Array.isArray(value.categories)) return ""

  const categories = value.categories
    .map((entry) => (entry && typeof entry === "object" ? (entry as Record<string, unknown>) : null))
    .filter((entry): entry is Record<string, unknown> => Boolean(entry))

  const named = categories
    .map((entry) => cleanText(String(entry.name || entry.slug || "")))
    .filter(Boolean)

  return named[0] || ""
}

function tokenize(value: string): string[] {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&[a-z0-9#]+;/gi, " ")
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/[^a-z0-9\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .map((part) => part.trim())
    .filter((part) =>
      Boolean(part) &&
      !CATALOG_STOPWORDS.has(part) &&
      !PURE_NUMBER_TOKEN.test(part) &&
      !NOISY_FRAGMENT_TOKEN.test(part),
    )
}

function extractProductRecords(input: unknown): unknown[] {
  if (Array.isArray(input)) {
    return input
  }

  if (input && typeof input === "object") {
    const record = input as Record<string, unknown>
    if (Array.isArray(record.products)) {
      return record.products
    }
  }

  return []
}

function parseCatalogDocuments(text: string): unknown {
  const trimmed = text.trim()
  if (!trimmed) {
    throw new Error("alfies_catalog_json_array_required")
  }

  try {
    return JSON.parse(trimmed)
  } catch {
    const docs = splitJsonDocuments(trimmed).map((chunk) => JSON.parse(chunk))
    if (docs.length === 1) return docs[0]
    return docs.flatMap((doc) => extractProductRecords(doc))
  }
}

function splitJsonDocuments(text: string): string[] {
  const docs: string[] = []
  let depth = 0
  let start = -1
  let inString = false
  let escaping = false

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]
    if (inString) {
      if (escaping) escaping = false
      else if (char === "\\") escaping = true
      else if (char === "\"") inString = false
      continue
    }

    if (char === "\"") {
      inString = true
      continue
    }

    if (char === "{") {
      if (depth === 0) start = index
      depth += 1
      continue
    }

    if (char === "}") {
      depth -= 1
      if (depth === 0 && start >= 0) {
        docs.push(text.slice(start, index + 1))
        start = -1
      }
    }
  }

  if (!docs.length) {
    throw new Error("alfies_catalog_json_array_required")
  }

  return docs
}

const CATALOG_STOPWORDS = new Set([
  "am",
  "and",
  "aus",
  "beim",
  "bio",
  "by",
  "das",
  "das",
  "den",
  "der",
  "dem",
  "des",
  "die",
  "dir",
  "doch",
  "du",
  "ein",
  "eine",
  "einer",
  "eines",
  "enjoy",
  "fur",
  "for",
  "fuer",
  "geniessen",
  "geniessen.",
  "genießen",
  "genieen",
  "hat",
  "ich",
  "im",
  "in",
  "ist",
  "it",
  "la",
  "le",
  "les",
  "man",
  "mit",
  "much",
  "oder",
  "von",
  "vom",
  "wann",
  "was",
  "wenn",
  "wie",
  "wir",
  "zu",
  "oder",
  "the",
  "und",
  "viel",
  "with",
])

const PURE_NUMBER_TOKEN = /^\d+$/
const NOISY_FRAGMENT_TOKEN = /^[a-z]{1,2}\d*$|^\d+[a-z]{1,2}$/

function readWarehousePrice(value: Record<string, unknown>): number | undefined {
  const warehouse = firstWarehouse(value)
  if (!warehouse) return undefined
  const displayPrice = warehouse.displayPrice && typeof warehouse.displayPrice === "object"
    ? (warehouse.displayPrice as Record<string, unknown>)
    : null
  const candidate =
    warehouse.price ??
    displayPrice?.priceInclTax ??
    displayPrice?.unitPriceInclTax ??
    null
  if (candidate === null || candidate === undefined || candidate === "") return undefined
  const numeric = Number(candidate)
  return Number.isFinite(numeric) ? numeric : undefined
}

function readWarehouseCurrency(value: Record<string, unknown>): string | undefined {
  const warehouse = firstWarehouse(value)
  if (!warehouse) return undefined
  const currency = cleanText(String(warehouse.currency || ""))
  return currency || undefined
}

function readWarehouseAvailability(value: Record<string, unknown>): Record<string, unknown> | undefined {
  const warehouse = firstWarehouse(value)
  if (!warehouse) return undefined
  const availability = warehouse.availability && typeof warehouse.availability === "object"
    ? (warehouse.availability as Record<string, unknown>)
    : null
  return availability || undefined
}

function firstWarehouse(value: Record<string, unknown>): Record<string, unknown> | null {
  const whs = value.whs && typeof value.whs === "object" && !Array.isArray(value.whs)
    ? (value.whs as Record<string, unknown>)
    : null
  if (!whs) return null
  const first = Object.values(whs).find((entry) => Boolean(entry) && typeof entry === "object")
  return first && typeof first === "object" ? (first as Record<string, unknown>) : null
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error)
    console.error(JSON.stringify({
      level: "error",
      event: "alfies_catalog_normalize_failed",
      message,
    }))
    process.exitCode = 1
  })
}
