import test from "node:test"
import assert from "node:assert/strict"
import { FileConversationStoreAdapter } from "./FileConversationStoreAdapter.js"
import type { ConversationSession } from "../domain/types.js"

test("conversation store persists a compact assistant/user history without tool payloads", async () => {
  let capturedProfile: Record<string, unknown> | null = null
  const fakeStore = {
    async upsertProfile(_whatsappUserId: string, value: Record<string, unknown>) {
      capturedProfile = value
    },
  } as any

  const store = new FileConversationStoreAdapter("ignored.sqlite", fakeStore)
  const session: ConversationSession = {
    conversationId: "c1",
    whatsappUserId: "49123",
    entries: [
      {
        role: "user",
        content: "Getraenke",
        createdAt: new Date(0).toISOString(),
      },
      {
        role: "tool",
        name: "catalog.browse_products",
        toolCallId: "tc_1",
        content: JSON.stringify({
          prompt: "Welche Produkte passen am besten zu 'getraenke'?",
          options: Array.from({ length: 80 }, (_, index) => ({
            label: `Beispiel Produkt ${index + 1}`,
            price: "1,99 €",
          })),
        }),
        createdAt: new Date(0).toISOString(),
      },
      {
        role: "assistant",
        content: `Welche Produkte passen am besten zu 'getraenke'?\n${"A".repeat(1200)}`,
        createdAt: new Date(0).toISOString(),
      },
    ],
    metadata: {
      currentMarketplaceOrderId: "guard_order_1cent",
      currentCheckoutUrl: "https://pay.example/checkout/test-1cent",
    },
  }

  await store.saveSession(session)

  const history = (capturedProfile as any)?.profile?.recentConversationHistory
  assert.ok(Array.isArray(history))
  assert.equal(history.length, 2)
  assert.match(String(history[0]), /^user:\s*Getraenke$/)
  assert.match(String(history[1]), /^assistant:\s*Welche Produkte passen/)
  assert.ok(!String(history[1]).includes("tool["))
  assert.ok(String(history[1]).length <= 520)
  assert.equal((capturedProfile as any)?.profile?.extractedEntities?.agent_current_marketplace_order_id, "guard_order_1cent")
  assert.equal((capturedProfile as any)?.profile?.extractedEntities?.agent_current_checkout_url, "https://pay.example/checkout/test-1cent")
})

test("conversation store persists shared marketplace session fields and legacy extracted entities", async () => {
  let capturedProfile: Record<string, unknown> | null = null
  const fakeStore = {
    async upsertProfile(_whatsappUserId: string, value: Record<string, unknown>) {
      capturedProfile = value
    },
  } as any

  const store = new FileConversationStoreAdapter("ignored.sqlite", fakeStore)
  const session: ConversationSession = {
    conversationId: "c2",
    whatsappUserId: "49124",
    entries: [
      {
        role: "user",
        content: "checkout",
        createdAt: new Date(0).toISOString(),
      },
      {
        role: "assistant",
        content: "Hier ist dein Zahlungslink.",
        createdAt: new Date(0).toISOString(),
      },
    ],
    metadata: {
      marketplaceSession: {
        merchantSlug: "alfies",
        resource: "merchant:alfies:channel",
        plan: "standard",
        marketplaceOrderId: "ord_123",
        checkoutUrl: "https://pay.example/checkout/ord_123",
        shippingDate: "2026-03-14",
        deliveryAddress: {
          city: "Wien",
          postcode: "1020",
        },
        deliveryNote: "Bitte klingeln",
        phone: "+43123456789",
      },
    },
  }

  await store.saveSession(session)

  const extracted = (capturedProfile as any)?.profile?.extractedEntities
  assert.equal(extracted?.agent_marketplace_resource, "merchant:alfies:channel")
  assert.equal(extracted?.agent_marketplace_plan, "standard")
  assert.equal(extracted?.agent_current_marketplace_order_id, "ord_123")
  assert.equal(extracted?.agent_current_checkout_url, "https://pay.example/checkout/ord_123")
  assert.equal(extracted?.agent_shipping_date, "2026-03-14")
  assert.deepEqual(extracted?.agent_delivery_address, {
    city: "Wien",
    postcode: "1020",
  })
  assert.equal(extracted?.agent_delivery_note, "Bitte klingeln")
  assert.equal(extracted?.agent_phone, "+43123456789")
})
