import { randomBytes } from "node:crypto"
import { FileStateStore } from "../../../whatsapp-bot/dist/whatsapp-bot/src/stateStore.js"
import type { CartMutationPort } from "../ports/CartMutationPort.js"

type ProductRecord = {
  product_id: number
  slug?: string
  title: string
  price_cents?: number
  currency?: string
}

export class SharedStateCartMutationPortAdapter implements CartMutationPort {
  private readonly store: FileStateStore

  constructor(stateFile: string) {
    this.store = new FileStateStore(stateFile)
  }

  async addBundle(args: {
    whatsappUserId: string
    productIds: number[]
  }): Promise<{ message: string; cart: Record<string, unknown> }> {
    const [conversation, profile, products] = await Promise.all([
      this.store.get(args.whatsappUserId),
      this.store.getProfile(args.whatsappUserId),
      this.store.listAlfiesProducts(),
    ])
    const orderId = ensureOrderId(conversation?.orderId)
    const currentCart = profile?.profile?.currentCartSnapshot || conversation?.lastCart || {}
    const items = Array.isArray(currentCart.items)
      ? currentCart.items.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object").map((item) => ({ ...item }))
      : []
    const addedTitles: string[] = []

    for (const productId of args.productIds) {
      const product = products.find((entry) => entry.product_id === productId)
      if (!product) continue
      const existingIndex = items.findIndex((item) => sameProduct(item, product))
      if (existingIndex >= 0) {
        const currentQty = Math.max(1, toInt(items[existingIndex]?.qty) || 1)
        items[existingIndex] = { ...items[existingIndex], qty: currentQty + 1 }
      } else {
        items.push(toCartLine(product, 1))
      }
      addedTitles.push(product.title)
    }

    const nextCart = recalculateCart(
      items,
      typeof currentCart.currency === "string" && currentCart.currency.trim() ? currentCart.currency.trim() : "EUR",
    )
    await this.persistCart(args.whatsappUserId, orderId, nextCart)
    return {
      message: addedTitles.length
        ? `Ich habe diese Artikel in den Warenkorb gelegt: ${addedTitles.join(", ")}.`
        : "Ich konnte aus der Auswahl leider noch nichts in den Warenkorb legen.",
      cart: nextCart,
    }
  }

  async addProduct(args: {
    whatsappUserId: string
    productId: number
    quantity: number
  }): Promise<{ message: string; cart: Record<string, unknown> }> {
    const { orderId, cart, product } = await this.loadState(args.whatsappUserId, args.productId)
    const existingIndex = cart.items.findIndex((item) => sameProduct(item, product))
    if (existingIndex >= 0) {
      const currentQty = Math.max(1, toInt(cart.items[existingIndex]?.qty) || 1)
      cart.items[existingIndex] = {
        ...cart.items[existingIndex],
        qty: currentQty + Math.max(1, Math.trunc(args.quantity)),
      }
    } else {
      cart.items.push(toCartLine(product, Math.max(1, Math.trunc(args.quantity))))
    }
    const nextCart = recalculateCart(cart.items, cart.currency || product.currency || "EUR")
    await this.persistCart(args.whatsappUserId, orderId, nextCart)
    return {
      message: `Ich habe ${Math.max(1, Math.trunc(args.quantity))}x ${product.title} zum Warenkorb hinzugefuegt.`,
      cart: nextCart,
    }
  }

  async removeProduct(args: {
    whatsappUserId: string
    productId: number
  }): Promise<{ message: string; cart: Record<string, unknown> }> {
    const { orderId, cart, product } = await this.loadState(args.whatsappUserId, args.productId)
    const nextItems = cart.items.filter((item) => !sameProduct(item, product))
    const nextCart = recalculateCart(nextItems, cart.currency || product.currency || "EUR")
    await this.persistCart(args.whatsappUserId, orderId, nextCart)
    return {
      message: `Ich habe ${product.title} aus dem Warenkorb entfernt.`,
      cart: nextCart,
    }
  }

  async setProductQuantity(args: {
    whatsappUserId: string
    productId: number
    quantity: number
  }): Promise<{ message: string; cart: Record<string, unknown> }> {
    const { orderId, cart, product } = await this.loadState(args.whatsappUserId, args.productId)
    const quantity = Math.max(1, Math.trunc(args.quantity))
    const nextItems = cart.items.map((item) =>
      sameProduct(item, product)
        ? { ...item, qty: quantity }
        : item
    )
    const nextCart = recalculateCart(nextItems, cart.currency || product.currency || "EUR")
    await this.persistCart(args.whatsappUserId, orderId, nextCart)
    return {
      message: `Ich habe die Menge fuer ${product.title} auf ${quantity} gesetzt.`,
      cart: nextCart,
    }
  }

  private async loadState(whatsappUserId: string, productId: number) {
    const [conversation, profile, products] = await Promise.all([
      this.store.get(whatsappUserId),
      this.store.getProfile(whatsappUserId),
      this.store.listAlfiesProducts(),
    ])
    const product = products.find((entry) => entry.product_id === productId)
    if (!product) throw new Error("catalog_product_not_found")

    const currentCart = profile?.profile?.currentCartSnapshot || conversation?.lastCart || {}
    const items = Array.isArray(currentCart.items)
      ? currentCart.items.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
      : []

    return {
      orderId: ensureOrderId(conversation?.orderId),
      profile,
      product,
      cart: {
        items: items.map((item) => ({ ...item })),
        currency: typeof currentCart.currency === "string" && currentCart.currency.trim() ? currentCart.currency.trim() : "EUR",
      },
    }
  }

  private async persistCart(whatsappUserId: string, orderId: string, cart: Record<string, unknown>) {
    await this.store.upsert(whatsappUserId, {
      orderId,
      lastCart: cart,
    })
    await this.store.upsertProfile(whatsappUserId, {
      onboardingStage: "guided",
      profile: {
        currentCartSnapshot: cart,
      },
    })
  }
}

function toCartLine(product: ProductRecord, quantity: number): Record<string, unknown> {
  return {
    product_id: product.product_id,
    sku: product.slug || String(product.product_id),
    name: product.title,
    qty: quantity,
    unit_price_cents: product.price_cents || 0,
    currency: product.currency || "EUR",
  }
}

function sameProduct(item: Record<string, unknown>, product: ProductRecord): boolean {
  return toInt(item.product_id) === product.product_id ||
    (typeof item.sku === "string" && item.sku === (product.slug || String(product.product_id)))
}

function recalculateCart(items: Record<string, unknown>[], currency: string): Record<string, unknown> {
  const total = items.reduce((sum, item) => {
    const qty = Math.max(0, toInt(item.qty) || 0)
    const price = Math.max(0, toInt(item.unit_price_cents) || 0)
    return sum + qty * price
  }, 0)
  return {
    items,
    total_cents: total,
    currency,
  }
}

function toInt(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return Math.trunc(value)
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return Math.trunc(parsed)
  }
  return undefined
}

function ensureOrderId(value: unknown): string {
  if (typeof value === "string" && value.trim()) return value.trim()
  return `ord_${Date.now()}_${randomBytes(3).toString("hex")}`
}
