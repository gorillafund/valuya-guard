import test from "node:test"
import assert from "node:assert/strict"
import { CartEditService } from "./cartEditService.js"
import type { ConversationSnapshot } from "./conversationStateService.js"
import type { StoredAlfiesProduct } from "./stateStore.js"

const service = new CartEditService()

const catalog: StoredAlfiesProduct[] = [
  {
    product_id: 1,
    slug: "tegernseer-helles",
    title: "Tegernseer Helles",
    price_cents: 159,
    currency: "EUR",
    keywords: ["beer", "bier", "helles"],
    category: "Bier",
    updated_at: "2026-03-09T00:00:00.000Z",
  },
]

test("asks for quantity when user narrows to a single product", () => {
  const snapshot: ConversationSnapshot = {
    subjectId: "user:1",
    profile: {
      lastShownProducts: [{ title: "Tegernseer Helles", sku: "tegernseer-helles", productId: 1 }],
    },
  }
  const result = service.resolve({
    message: "Nur Tegernseer Helles",
    snapshot,
    catalog,
  })
  assert.equal(result.kind, "needs_quantity")
  assert.equal(result.product.title, "Tegernseer Helles")
})

test("binds numeric follow-up to active quantity question", () => {
  const snapshot: ConversationSnapshot = {
    subjectId: "user:1",
    profile: {
      activeProductCandidate: {
        productId: 1,
        sku: "tegernseer-helles",
        title: "Tegernseer Helles",
        unitPriceCents: 159,
        currency: "EUR",
      },
      activeQuestion: {
        kind: "quantity_for_product",
        productTitle: "Tegernseer Helles",
      },
    },
  }
  const result = service.resolve({
    message: "20",
    snapshot,
    catalog,
  })
  assert.equal(result.kind, "replace_with_single_product")
  assert.equal(result.quantity, 20)
})

test("crate request falls back to bottle clarification when no crate product exists", () => {
  const snapshot: ConversationSnapshot = {
    subjectId: "user:1",
    profile: {
      lastShownProducts: [{ title: "Tegernseer Helles", sku: "tegernseer-helles", productId: 1 }],
    },
  }
  const result = service.resolve({
    message: "Ich moechte nur eine Kiste Tegernseer Helles",
    snapshot,
    catalog,
  })
  assert.equal(result.kind, "needs_quantity")
  assert.match(result.question, /Kiste|Flaschen/)
})
