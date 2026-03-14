import type { ConversationSnapshot } from "./conversationStateService.js"
import type { StoredAlfiesProduct } from "./stateStore.js"

export type ProductContextReply = {
  text: string
  nextQuestion?: {
    kind: "quantity_for_product"
    productTitle: string
    packagingHint?: string
  }
}

export function buildActiveProductContextReply(args: {
  message: string
  snapshot: ConversationSnapshot
  catalog: StoredAlfiesProduct[]
}): ProductContextReply | null {
  const normalized = normalize(args.message)
  const active = args.snapshot.profile?.activeProductCandidate
  if (!active?.title) return null

  const catalogProduct = args.catalog.find((product) =>
    (active.productId && product.product_id === active.productId) ||
    (active.sku && product.slug === active.sku) ||
    normalize(product.title) === normalize(active.title),
  )

  if (isPackagingOnlyAnswer(normalized)) {
    return {
      text: `Alles klar. Wie viele ${normalized.includes("kist") || normalized.includes("kasten") ? "Kisten" : "Flaschen"} ${active.title} moechtest du bestellen?`,
      nextQuestion: {
        kind: "quantity_for_product",
        productTitle: active.title,
        packagingHint: normalized.includes("kist") || normalized.includes("kasten") ? "crate" : "bottle",
      },
    }
  }

  if (isPriceQuestion(normalized) && typeof active.unitPriceCents === "number") {
    return {
      text: `${active.title} kostet ${formatMoney(active.unitPriceCents, active.currency || "EUR")} pro Einheit.`,
    }
  }

  if (isOrganicQuestion(normalized)) {
    const bio = hasKeyword(catalogProduct, ["bio", "organic"])
    return {
      text: bio
        ? `${active.title} ist im Katalog als bio erkennbar.`
        : `${active.title} ist im Katalog aktuell nicht als bio markiert.`,
    }
  }

  if (isRegionalQuestion(normalized)) {
    const regional = hasKeyword(catalogProduct, ["regional", "oesterreich", "österreich", "austria", "lokal", "local"])
    return {
      text: regional
        ? `${active.title} wirkt im Katalog regional markiert.`
        : `${active.title} ist im Katalog aktuell nicht klar als regional markiert.`,
    }
  }

  if (isSizeQuestion(normalized)) {
    const size = inferSize(active.title)
    return {
      text: size
        ? `${active.title} hat laut Titel die Groesse ${size}.`
        : `Ich sehe die Groesse von ${active.title} nicht eindeutig im Katalogtitel.`,
    }
  }

  if (isCheaperQuestion(normalized) && catalogProduct) {
    const cheaper = findCheaperAlternative(catalogProduct, args.catalog)
    return cheaper
      ? {
          text: `Eine guenstigere Alternative waere ${cheaper.title} fuer ${formatMoney(cheaper.price_cents || 0, cheaper.currency || "EUR")}.`,
        }
      : {
          text: `Ich sehe aktuell keine guenstigere passende Alternative zu ${active.title}.`,
        }
  }

  return null
}

function findCheaperAlternative(product: StoredAlfiesProduct, catalog: StoredAlfiesProduct[]): StoredAlfiesProduct | null {
  const category = normalize(String(product.category || ""))
  const keywordSet = new Set((product.keywords || []).map(normalize))
  return catalog
    .filter((candidate) =>
      candidate.product_id !== product.product_id &&
      normalize(String(candidate.category || "")) === category &&
      (candidate.price_cents || Number.MAX_SAFE_INTEGER) < (product.price_cents || 0) &&
      candidate.keywords.some((keyword) => keywordSet.has(normalize(keyword))),
    )
    .sort((a, b) => (a.price_cents || Number.MAX_SAFE_INTEGER) - (b.price_cents || Number.MAX_SAFE_INTEGER))[0] || null
}

function hasKeyword(product: StoredAlfiesProduct | undefined, wanted: string[]): boolean {
  const keywords = new Set([
    normalize(product?.title || ""),
    normalize(product?.category || ""),
    ...(product?.keywords || []).map(normalize),
  ])
  return wanted.some((value) => keywords.has(normalize(value)))
}

function inferSize(title: string): string | null {
  const match = title.match(/(\d+(?:[.,]\d+)?)\s?(ml|l|g|kg|stk|x\s?\d+)/i)
  return match ? match[0] : null
}

function isPackagingOnlyAnswer(normalized: string): boolean {
  return /^(flasche|flaschen|bottle|bottles|kiste|kasten|crate|case)$/.test(normalized)
}

function isPriceQuestion(normalized: string): boolean {
  return /\b(wie viel kostet|was kostet|preis|how much|cost)\b/.test(normalized)
}

function isOrganicQuestion(normalized: string): boolean {
  return /\b(ist das bio|bio\?|organic)\b/.test(normalized)
}

function isRegionalQuestion(normalized: string): boolean {
  return /\b(ist das regional|regional\?|lokal\?|local)\b/.test(normalized)
}

function isSizeQuestion(normalized: string): boolean {
  return /\b(wie gross|welche groesse|welche grosse|size|groesse|grosse)\b/.test(normalized)
}

function isCheaperQuestion(normalized: string): boolean {
  return /\b(guenstig\w*|gunstig\w*|cheap\w*|billig\w*)\b/.test(normalized)
}

function normalize(value: string): string {
  return String(value || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/ß/g, "ss")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\w\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

function formatMoney(cents: number, currency: string): string {
  return `${(cents / 100).toFixed(2)} ${currency}`
}
