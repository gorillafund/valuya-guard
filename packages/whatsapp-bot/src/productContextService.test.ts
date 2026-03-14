import test from "node:test"
import assert from "node:assert/strict"
import { buildActiveProductContextReply } from "./productContextService.js"
import type { ConversationSnapshot } from "./conversationStateService.js"
import type { StoredAlfiesProduct } from "./stateStore.js"

const catalog: StoredAlfiesProduct[] = [
  {
    product_id: 1,
    slug: "tegernseer-helles-05l",
    title: "Tegernseer Helles 0.5l",
    price_cents: 159,
    currency: "EUR",
    keywords: ["beer", "regional", "oesterreich"],
    category: "Bier",
    updated_at: "2026-03-09T00:00:00.000Z",
  },
  {
    product_id: 2,
    slug: "budget-helles-05l",
    title: "Budget Helles 0.5l",
    price_cents: 129,
    currency: "EUR",
    keywords: ["beer"],
    category: "Bier",
    updated_at: "2026-03-09T00:00:00.000Z",
  },
  {
    product_id: 3,
    slug: "bio-saft-1l",
    title: "Bio Apfelsaft 1L",
    price_cents: 249,
    currency: "EUR",
    keywords: ["bio", "organic"],
    category: "Saft",
    updated_at: "2026-03-09T00:00:00.000Z",
  },
]

function snapshotFor(productId = 1): ConversationSnapshot {
  return {
    subjectId: "user:1",
    profile: {
      activeProductCandidate: {
        productId,
        sku: catalog.find((item) => item.product_id === productId)?.slug,
        title: catalog.find((item) => item.product_id === productId)?.title || "",
        unitPriceCents: catalog.find((item) => item.product_id === productId)?.price_cents,
        currency: catalog.find((item) => item.product_id === productId)?.currency,
      },
    },
  }
}

test("answers price questions from active product context", () => {
  const reply = buildActiveProductContextReply({
    message: "Wie viel kostet die Flasche?",
    snapshot: snapshotFor(),
    catalog,
  })
  assert.equal(reply?.text, "Tegernseer Helles 0.5l kostet 1.59 EUR pro Einheit.")
})

test("answers packaging-only replies by asking for quantity", () => {
  const reply = buildActiveProductContextReply({
    message: "Flaschen",
    snapshot: snapshotFor(),
    catalog,
  })
  assert.match(reply?.text || "", /Wie viele Flaschen/)
  assert.equal(reply?.nextQuestion?.kind, "quantity_for_product")
  assert.equal(reply?.nextQuestion?.packagingHint, "bottle")
})

test("answers regional and size questions", () => {
  const regional = buildActiveProductContextReply({
    message: "Ist das regional?",
    snapshot: snapshotFor(),
    catalog,
  })
  assert.match(regional?.text || "", /regional markiert/)

  const size = buildActiveProductContextReply({
    message: "Welche Größe hat die Flasche?",
    snapshot: snapshotFor(),
    catalog,
  })
  assert.match(size?.text || "", /0.5l/)
})

test("offers cheaper alternatives for active product", () => {
  const reply = buildActiveProductContextReply({
    message: "Hast du etwas guenstigeres?",
    snapshot: snapshotFor(),
    catalog,
  })
  assert.match(reply?.text || "", /Budget Helles/)
})
