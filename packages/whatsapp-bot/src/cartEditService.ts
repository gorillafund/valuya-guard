import type { ConversationSnapshot } from "./conversationStateService.js"
import type { StoredAlfiesProduct } from "./stateStore.js"

export type CartEditResolution =
  | {
      kind: "none"
    }
  | {
      kind: "needs_quantity"
      product: {
        productId: number
        sku?: string
        title: string
        unitPriceCents?: number
        currency?: string
      }
      packagingHint?: string
      question: string
    }
  | {
      kind: "replace_with_single_product"
      product: {
        productId: number
        sku?: string
        title: string
        unitPriceCents?: number
        currency?: string
      }
      quantity: number
      packagingHint?: string
    }

export class CartEditService {
  resolve(args: {
    message: string
    snapshot: ConversationSnapshot
    catalog: StoredAlfiesProduct[]
  }): CartEditResolution {
    const normalized = normalize(args.message)
    const product = findBestProductCandidate(normalized, args.snapshot, args.catalog)
    const quantity = extractQuantity(normalized)
    const packagingHint = extractPackagingHint(normalized)

    const activeQuestion = args.snapshot.profile?.activeQuestion
    const activeProduct = args.snapshot.profile?.activeProductCandidate

    if (activeQuestion?.kind === "quantity_for_product" && activeProduct && quantity) {
      return {
        kind: "replace_with_single_product",
        product: {
          productId: activeProduct.productId || 0,
          sku: activeProduct.sku,
          title: activeProduct.title,
          unitPriceCents: activeProduct.unitPriceCents,
          currency: activeProduct.currency,
        },
        quantity: packagingHint === "crate" && quantity < 6 ? quantity * 20 : quantity,
        packagingHint,
      }
    }

    if (!isSingleProductRefinement(normalized)) {
      return { kind: "none" }
    }

    if (!product) {
      return { kind: "none" }
    }

    if (quantity) {
      return {
        kind: "replace_with_single_product",
        product,
        quantity: packagingHint === "crate" && quantity < 6 ? quantity * 20 : quantity,
        packagingHint,
      }
    }

    return {
      kind: "needs_quantity",
      product,
      packagingHint,
      question: packagingHint === "crate"
        ? `Ich habe ${product.title} erkannt. Ich sehe es aktuell nicht sicher als Kiste im Katalog. Soll ich stattdessen Flaschen dafuer einplanen? Wenn ja: wie viele Flaschen moechtest du?`
        : `Wie viele Flaschen ${product.title} moechtest du bestellen?`,
    }
  }
}

function isSingleProductRefinement(normalized: string): boolean {
  return /\b(nur|only|just)\b/.test(normalized) ||
    /\b(ich mochte|ich möchte|ich will|give me|brauch|nehme)\b/.test(normalized) ||
    normalized.split(" ").length <= 4
}

function findBestProductCandidate(
  normalized: string,
  snapshot: ConversationSnapshot,
  catalog: StoredAlfiesProduct[],
): CartEditResolution extends infer _ ? {
  productId: number
  sku?: string
  title: string
  unitPriceCents?: number
  currency?: string
} | null : never {
  const lastShown = snapshot.profile?.lastShownProducts || []
  const stripped = stripEditWords(normalized)

  const lastShownMatch = lastShown
    .map((item) => ({
      item,
      score: overlapScore(stripped, normalize(item.title)),
    }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score)[0]

  if (lastShownMatch?.item) {
    const catalogProduct = catalog.find((product) =>
      product.product_id === lastShownMatch.item.productId ||
      (lastShownMatch.item.sku && (product.slug === lastShownMatch.item.sku || String(product.product_id) === lastShownMatch.item.sku)) ||
      normalize(product.title) === normalize(lastShownMatch.item.title),
    )
    if (catalogProduct) {
      return {
        productId: catalogProduct.product_id,
        sku: catalogProduct.slug,
        title: catalogProduct.title,
        unitPriceCents: catalogProduct.price_cents,
        currency: catalogProduct.currency,
      }
    }
  }

  const catalogMatch = catalog
    .map((product) => ({
      product,
      score: overlapScore(stripped, normalize(product.title)),
    }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.product.title.length - b.product.title.length)[0]

  if (!catalogMatch) return null
  return {
    productId: catalogMatch.product.product_id,
    sku: catalogMatch.product.slug,
    title: catalogMatch.product.title,
    unitPriceCents: catalogMatch.product.price_cents,
    currency: catalogMatch.product.currency,
  }
}

function stripEditWords(normalized: string): string {
  return normalized
    .replace(/\b(ich mochte|ich möchte|ich will|nur|only|just|eine|einen|einer|ein|kiste|kasten|flaschen|flasche)\b/g, " ")
    .replace(/\b\d+\b/g, " ")
    .replace(/\s+/g, " ")
    .trim()
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

function extractQuantity(normalized: string): number | null {
  const match = normalized.match(/\b(\d{1,3})\b/)
  if (!match?.[1]) return null
  const parsed = Math.trunc(Number(match[1]))
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

function extractPackagingHint(normalized: string): "crate" | "bottle" | undefined {
  if (/\b(kiste|kasten|crate|case|box)\b/.test(normalized)) return "crate"
  if (/\b(flaschen|flasche|bottle|bottles)\b/.test(normalized)) return "bottle"
  return undefined
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
