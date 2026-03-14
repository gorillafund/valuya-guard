import type { IntentExtraction } from "./intentExtractionService.js"
import type { StoredAlfiesProduct } from "./stateStore.js"

export type MutableCart = {
  items?: unknown[]
  total_cents?: number
  currency?: string
}

export type CartMutationResult =
  | {
      kind: "clarify"
      message: string
    }
  | {
      kind: "mutated"
      message: string
      cart: {
        items: unknown[]
        total_cents: number
        currency: string
      }
      activeProduct?: {
        productId?: number
        sku?: string
        title: string
        unitPriceCents?: number
        currency?: string
      }
    }

export function applyResolvedCartMutation(args: {
  cart: MutableCart | undefined
  product: StoredAlfiesProduct
  quantity: number
  mode: "append" | "replace"
}): CartMutationResult {
  const quantity = Math.max(1, Math.trunc(Number(args.quantity || 1)))
  const workingCart = cloneCart(args.cart)
  const nextItems =
    args.mode === "replace"
      ? [
          {
            product_id: args.product.product_id,
            sku: args.product.slug || String(args.product.product_id),
            name: args.product.title,
            qty: quantity,
            unit_price_cents: args.product.price_cents || 0,
            currency: args.product.currency || "EUR",
          },
        ]
      : appendResolvedProduct(workingCart.items, args.product, quantity)

  const cart = recalculateCart(nextItems, workingCart.currency || args.product.currency || "EUR")
  return {
    kind: "mutated",
    message:
      args.mode === "replace"
        ? `Ich stelle den Warenkorb auf ${args.product.title} um.`
        : `Ich habe ${quantity}x ${args.product.title} zum Warenkorb hinzugefuegt.`,
    cart,
    activeProduct: toActiveProduct(args.product),
  }
}

export function applyCartMutation(args: {
  cart: MutableCart | undefined
  extraction: IntentExtraction
  catalog: StoredAlfiesProduct[]
  resolvedReference?: {
    productId?: number
    sku?: string
    title: string
  }
}): CartMutationResult {
  if (
    args.extraction.needs_clarification ||
    args.extraction.clarification_needed ||
    args.extraction.selection_mode === "clarify" ||
    args.extraction.context_relation === "unclear" ||
    (
      args.extraction.references_to_previous_context.has_reference &&
      args.extraction.reference_strength === "weak" &&
      !args.resolvedReference
    )
  ) {
    return {
      kind: "clarify",
      message: args.extraction.clarification_question || "Ich bin noch nicht sicher, worauf du dich beziehst. Kannst du das kurz praezisieren?",
    }
  }

  const workingCart = cloneCart(args.cart)
  const target = resolveTargetProduct(args.extraction, args.catalog, args.resolvedReference)

  if (!target) {
    return {
      kind: "clarify",
      message: "Ich konnte das Produkt nicht sicher zuordnen. Nenne bitte den Produktnamen noch etwas genauer.",
    }
  }

  if (args.extraction.cart_action === "remove") {
    const items = workingCart.items.filter((item) => !matchesItem(item, target))
    const cart = recalculateCart(items, workingCart.currency)
    return {
      kind: "mutated",
      message: `Ich habe ${target.title} aus dem Warenkorb entfernt.`,
      cart,
      activeProduct: toActiveProduct(target),
    }
  }

  const quantity = normalizeRequestedQuantity(args.extraction) || 1

  if (args.extraction.cart_action === "update") {
    const items = workingCart.items.map((item) => {
      const next = { ...(item as Record<string, unknown>) }
      if (matchesItem(next, target)) {
        next.qty = quantity
      }
      return next
    })
    const cart = recalculateCart(items, workingCart.currency || target.currency || "EUR")
    return {
      kind: "mutated",
      message: `Ich habe die Menge fuer ${target.title} auf ${quantity} gesetzt.`,
      cart,
      activeProduct: toActiveProduct(target),
    }
  }

  const existing = workingCart.items.find((item) => matchesItem(item as Record<string, unknown>, target))
  if (existing) {
    const items = workingCart.items.map((item) => {
      const next = { ...(item as Record<string, unknown>) }
      if (matchesItem(next, target)) {
        next.qty = Math.max(1, Math.trunc(Number(next.qty || 1)) + quantity)
      }
      return next
    })
    const cart = recalculateCart(items, workingCart.currency || target.currency || "EUR")
    return {
      kind: "mutated",
      message: `Ich habe ${quantity}x ${target.title} zum bestehenden Artikel hinzugefuegt.`,
      cart,
      activeProduct: toActiveProduct(target),
    }
  }

  const items = [
    ...workingCart.items,
    {
      product_id: target.product_id,
      sku: target.slug || String(target.product_id),
      name: target.title,
      qty: quantity,
      unit_price_cents: target.price_cents || 0,
      currency: target.currency || "EUR",
    },
  ]
  const cart = recalculateCart(items, workingCart.currency || target.currency || "EUR")
  return {
    kind: "mutated",
    message: `Ich habe ${quantity}x ${target.title} zum Warenkorb hinzugefuegt.`,
    cart,
    activeProduct: toActiveProduct(target),
  }
}

function appendResolvedProduct(
  items: Record<string, unknown>[],
  product: StoredAlfiesProduct,
  quantity: number,
): Record<string, unknown>[] {
  const existing = items.find((item) => matchesItem(item, product))
  if (!existing) {
    return [
      ...items,
      {
        product_id: product.product_id,
        sku: product.slug || String(product.product_id),
        name: product.title,
        qty: quantity,
        unit_price_cents: product.price_cents || 0,
        currency: product.currency || "EUR",
      },
    ]
  }
  return items.map((item) => {
    const next = { ...item }
    if (matchesItem(next, product)) {
      next.qty = Math.max(1, Math.trunc(Number(next.qty || 1)) + quantity)
    }
    return next
  })
}

function resolveTargetProduct(
  extraction: IntentExtraction,
  catalog: StoredAlfiesProduct[],
  resolvedReference?: { productId?: number; sku?: string; title: string },
): StoredAlfiesProduct | null {
  if (resolvedReference?.productId || resolvedReference?.sku || resolvedReference?.title) {
    return catalog.find((product) =>
      (resolvedReference.productId && product.product_id === resolvedReference.productId) ||
      (resolvedReference.sku && product.slug === resolvedReference.sku) ||
      normalize(product.title) === normalize(resolvedReference.title),
    ) || null
  }

  const query = extraction.product_queries[0]?.name
  if (!query) return null
  const normalized = normalize(query)
  const matches = catalog
    .map((product) => ({
      product,
      score: overlapScore(normalized, normalize([product.title, product.category, ...product.keywords].join(" "))),
    }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || (a.product.price_cents || 0) - (b.product.price_cents || 0))
  return matches.length > 0 && matches[0]!.score >= 1 ? matches[0]!.product : null
}

function normalizeRequestedQuantity(extraction: IntentExtraction): number | null {
  const value = extraction.product_queries[0]?.quantity
  if (typeof value !== "number" || !Number.isFinite(value)) return null
  const quantity = Math.trunc(value)
  return quantity > 0 ? quantity : null
}

function cloneCart(cart: MutableCart | undefined): { items: Record<string, unknown>[]; currency: string } {
  const items = Array.isArray(cart?.items)
    ? cart.items.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object").map((item) => ({ ...item }))
    : []
  return {
    items,
    currency: String(cart?.currency || "EUR"),
  }
}

function matchesItem(item: Record<string, unknown>, target: StoredAlfiesProduct): boolean {
  return (typeof item.product_id === "number" && Math.trunc(item.product_id) === target.product_id) ||
    (typeof item.sku === "string" && item.sku === (target.slug || String(target.product_id))) ||
    normalize(String(item.name || item.title || "")) === normalize(target.title)
}

function recalculateCart(items: Record<string, unknown>[], currency: string): {
  items: unknown[]
  total_cents: number
  currency: string
} {
  const total = items.reduce(
    (sum, item) => sum + Math.trunc(Number(item.qty || 0)) * Math.trunc(Number(item.unit_price_cents || 0)),
    0,
  )
  return {
    items,
    total_cents: total,
    currency,
  }
}

function toActiveProduct(product: StoredAlfiesProduct): {
  productId?: number
  sku?: string
  title: string
  unitPriceCents?: number
  currency?: string
} {
  return {
    productId: product.product_id,
    sku: product.slug,
    title: product.title,
    unitPriceCents: product.price_cents,
    currency: product.currency,
  }
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

function normalize(value: string): string {
  return String(value || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\w\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}
