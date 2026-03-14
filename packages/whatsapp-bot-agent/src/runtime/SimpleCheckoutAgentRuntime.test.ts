import test from "node:test"
import assert from "node:assert/strict"
import { SimpleCheckoutAgentRuntime } from "./SimpleCheckoutAgentRuntime.js"
import type { ConversationSession } from "../domain/types.js"
import type { ShoppingPlanner } from "./ShoppingPlanner.js"

test("runtime asks for entitlement check before checkout", async () => {
  const runtime = new SimpleCheckoutAgentRuntime()
  const session: ConversationSession = {
    conversationId: "c1",
    whatsappUserId: "49123",
    entries: [
      {
        role: "user",
        content: "checkout",
        createdAt: new Date(0).toISOString(),
      },
    ],
    metadata: {
      currentOrderId: "ord_1",
      currentCartSnapshot: {
        items: [{ sku: "alfies-1", name: "Milch", qty: 2, unit_price_cents: 219 }],
        total_cents: 438,
        currency: "EUR",
      },
    },
  }

  const result = await runtime.runTurn({
    linkedSubject: { protocolSubjectHeader: "app_user:1" },
    session,
    tools: [],
  })

  assert.equal(result.toolCalls?.[0]?.name, "valuya.get_entitlement")
})

test("runtime returns checkout link reply after tool results exist", async () => {
  const runtime = new SimpleCheckoutAgentRuntime()
  const session: ConversationSession = {
    conversationId: "c1",
    whatsappUserId: "49123",
    entries: [
      {
        role: "user",
        content: "checkout",
        createdAt: new Date(0).toISOString(),
      },
      {
        role: "tool",
        name: "valuya.get_entitlement",
        content: JSON.stringify({ active: false, reason: "inactive" }),
        createdAt: new Date(0).toISOString(),
      },
      {
        role: "tool",
        name: "valuya.create_marketplace_order",
        content: JSON.stringify({ valuyaOrderId: "ord_srv_1" }),
        createdAt: new Date(0).toISOString(),
      },
      {
        role: "tool",
        name: "valuya.create_checkout_link",
        content: JSON.stringify({ checkoutUrl: "https://pay.example/checkout/1" }),
        createdAt: new Date(0).toISOString(),
      },
    ],
    metadata: {
      currentOrderId: "ord_1",
      currentCartSnapshot: {
        items: [{ sku: "alfies-1", name: "Milch", qty: 2, unit_price_cents: 219 }],
        total_cents: 438,
        currency: "EUR",
      },
    },
  }

  const result = await runtime.runTurn({
    linkedSubject: { protocolSubjectHeader: "app_user:1" },
    session,
    tools: [],
  })

  assert.match(String(result.reply || ""), /Zahlungslink/)
  assert.match(String(result.reply || ""), /status/)
})

test("runtime supports a 1cent test checkout command", async () => {
  const runtime = new SimpleCheckoutAgentRuntime()
  const session: ConversationSession = {
    conversationId: "c1",
    whatsappUserId: "49123",
    entries: [
      {
        role: "user",
        content: "1cent",
        createdAt: new Date(0).toISOString(),
      },
      {
        role: "tool",
        name: "valuya.get_entitlement",
        content: JSON.stringify({ active: false, reason: "inactive" }),
        createdAt: new Date(0).toISOString(),
      },
      {
        role: "tool",
        name: "valuya.create_marketplace_order",
        content: JSON.stringify({ valuyaOrderId: "ord_srv_test_1cent" }),
        createdAt: new Date(0).toISOString(),
      },
      {
        role: "tool",
        name: "valuya.create_checkout_link",
        content: JSON.stringify({ checkoutUrl: "https://pay.example/checkout/test-1cent" }),
        createdAt: new Date(0).toISOString(),
      },
    ],
    metadata: {
      currentCartSnapshot: {
        items: [{ sku: "alfies-1", name: "Milch", qty: 2, unit_price_cents: 219 }],
        total_cents: 438,
        currency: "EUR",
      },
    },
  }

  const result = await runtime.runTurn({
    linkedSubject: { protocolSubjectHeader: "app_user:1" },
    session,
    tools: [],
  })

  assert.match(String(result.reply || ""), /1-Cent-Testcheckout/)
  assert.match(String(result.reply || ""), /0,01 EUR/)
  assert.match(String(result.reply || ""), /checkout\/test-1cent/)
  assert.equal(result.metadata?.plannerAction, undefined)
  assert.equal(result.metadata?.plannerQuery, undefined)
  assert.equal(result.metadata?.currentMarketplaceOrderId, "ord_srv_test_1cent")
})

test("runtime dispatches an order after entitlement is active and user confirms", async () => {
  const runtime = new SimpleCheckoutAgentRuntime()
  const session: ConversationSession = {
    conversationId: "c1",
    whatsappUserId: "49123",
    entries: [
      {
        role: "user",
        content: "confirm",
        createdAt: new Date(0).toISOString(),
      },
      {
        role: "tool",
        name: "cart.get_active",
        content: JSON.stringify({
          orderId: "ord_1",
          items: [{ sku: "alfies-1", name: "Milch", qty: 2, unit_price_cents: 219 }],
          totalCents: 438,
          currency: "EUR",
        }),
        createdAt: new Date(0).toISOString(),
      },
      {
        role: "tool",
        name: "valuya.get_entitlement",
        content: JSON.stringify({ active: true }),
        createdAt: new Date(0).toISOString(),
      },
    ],
    metadata: {
      currentCartSnapshot: {
        items: [{ sku: "alfies-1", name: "Milch", qty: 2, unit_price_cents: 219 }],
        total_cents: 438,
        currency: "EUR",
      },
    },
  }

  const result = await runtime.runTurn({
    linkedSubject: { protocolSubjectHeader: "app_user:1" },
    session,
    tools: [],
  })

  assert.equal(result.toolCalls?.[0]?.name, "alfies.dispatch_order")
})

test("runtime prepares Alfies checkout before Guard checkout when delivery context exists", async () => {
  const runtime = new SimpleCheckoutAgentRuntime()
  const session: ConversationSession = {
    conversationId: "c1",
    whatsappUserId: "49123",
    entries: [
      {
        role: "user",
        content: "checkout",
        createdAt: new Date(0).toISOString(),
      },
      {
        role: "tool",
        name: "valuya.get_entitlement",
        content: JSON.stringify({ active: false, reason: "inactive" }),
        createdAt: new Date(0).toISOString(),
      },
    ],
    metadata: {
      currentOrderId: "ord_alfies_1",
      currentCartSnapshot: {
        items: [{ sku: "alfies-1", name: "Milch", qty: 2, unit_price_cents: 219 }],
        total_cents: 438,
        currency: "EUR",
      },
      shippingDate: "2026-03-14",
      deliveryAddress: {
        line1: "Praterstrasse",
        house: "12A",
        postcode: "1020",
        city: "Wien",
        latitude: 48.214,
        longitude: 16.385,
      },
    },
  }

  const result = await runtime.runTurn({
    linkedSubject: { protocolSubjectHeader: "app_user:1" },
    session,
    tools: [],
  })

  assert.equal(result.toolCalls?.[0]?.name, "alfies.prepare_checkout")
  assert.equal(result.toolCalls?.[0]?.input?.localOrderId, "ord_alfies_1")
  assert.equal(result.toolCalls?.[0]?.input?.shippingDate, "2026-03-14")
})

test("runtime submits a paid Alfies order from the prepared checkout snapshot", async () => {
  const runtime = new SimpleCheckoutAgentRuntime()
  const session: ConversationSession = {
    conversationId: "c1",
    whatsappUserId: "49123",
    entries: [
      {
        role: "user",
        content: "confirm",
        createdAt: new Date(0).toISOString(),
      },
      {
        role: "tool",
        name: "valuya.get_entitlement",
        content: JSON.stringify({ active: true }),
        createdAt: new Date(0).toISOString(),
      },
      {
        role: "tool",
        name: "valuya.create_marketplace_order",
        content: JSON.stringify({ valuyaOrderId: "guard_order_1" }),
        createdAt: new Date(0).toISOString(),
      },
      {
        role: "tool",
        name: "alfies.prepare_checkout",
        content: JSON.stringify({
          basketTotalCents: 1299,
          currency: "EUR",
          shippingAddress: {
            line1: "Praterstrasse",
            house: "12A",
            postcode: "1020",
            city: "Wien",
            latitude: 48.214,
            longitude: 16.385,
          },
          suggestedShippingOption: {
            code: "express_1800_1900",
            date: "2026-03-14",
            name: "18:00 - 19:00",
          },
        }),
        createdAt: new Date(0).toISOString(),
      },
    ],
    metadata: {
      currentOrderId: "ord_paid_1",
      currentCartSnapshot: {
        items: [{ sku: "alfies-1", name: "Milch", qty: 2, unit_price_cents: 219 }],
        total_cents: 438,
        currency: "EUR",
      },
    },
  }

  const result = await runtime.runTurn({
    linkedSubject: { protocolSubjectHeader: "app_user:1" },
    session,
    tools: [],
  })

  assert.equal(result.toolCalls?.[0]?.name, "alfies.submit_paid_order")
  assert.equal(result.toolCalls?.[0]?.input?.paymentReference, "guard_order_1")
  assert.equal(result.toolCalls?.[0]?.input?.expectedTotalCents, 1299)
})

test("runtime includes on-chain transaction and email dispatch note after paid submit", async () => {
  const runtime = new SimpleCheckoutAgentRuntime()
  const session: ConversationSession = {
    conversationId: "c1",
    whatsappUserId: "49123",
    entries: [
      {
        role: "user",
        content: "confirm",
        createdAt: new Date(0).toISOString(),
      },
      {
        role: "tool",
        name: "valuya.get_entitlement",
        content: JSON.stringify({ active: true }),
        createdAt: new Date(0).toISOString(),
      },
      {
        role: "tool",
        name: "valuya.create_marketplace_order",
        content: JSON.stringify({ valuyaOrderId: "guard_order_1" }),
        createdAt: new Date(0).toISOString(),
      },
      {
        role: "tool",
        name: "alfies.submit_paid_order",
        content: JSON.stringify({ externalOrderId: "alfies_123" }),
        createdAt: new Date(0).toISOString(),
      },
      {
        role: "tool",
        name: "valuya.get_marketplace_order",
        content: JSON.stringify({ txHash: "0xabc123", chainId: 8453 }),
        createdAt: new Date(0).toISOString(),
      },
    ],
    metadata: {
      currentCartSnapshot: {
        items: [{ sku: "alfies-1", name: "Milch", qty: 2, unit_price_cents: 219 }],
        total_cents: 438,
        currency: "EUR",
      },
    },
  }

  const result = await runtime.runTurn({
    linkedSubject: { protocolSubjectHeader: "app_user:1" },
    session,
    tools: [],
  })

  assert.match(String(result.reply || ""), /On-chain Transaktion: 0xabc123/)
  assert.match(String(result.reply || ""), /polygonscan\.com\/tx\/0xabc123/)
  assert.match(String(result.reply || ""), /E-Mail\/CSV Versand wurde ausgeloest/)
  assert.match(String(result.reply || ""), /Alfies Bestellnummer: alfies_123/)
})

test("runtime fetches marketplace order details on status when payment is active but Alfies submit has not happened yet", async () => {
  const runtime = new SimpleCheckoutAgentRuntime()
  const session: ConversationSession = {
    conversationId: "c1",
    whatsappUserId: "49123",
    entries: [
      {
        role: "user",
        content: "status",
        createdAt: new Date(0).toISOString(),
      },
      {
        role: "tool",
        name: "valuya.get_entitlement",
        content: JSON.stringify({ active: true }),
        createdAt: new Date(0).toISOString(),
      },
      {
        role: "tool",
        name: "valuya.create_marketplace_order",
        content: JSON.stringify({ valuyaOrderId: "guard_order_1" }),
        createdAt: new Date(0).toISOString(),
      },
    ],
    metadata: {
      currentCartSnapshot: {
        items: [{ sku: "alfies-1", name: "Milch", qty: 2, unit_price_cents: 219 }],
        total_cents: 438,
        currency: "EUR",
      },
    },
  }

  const result = await runtime.runTurn({
    linkedSubject: { protocolSubjectHeader: "app_user:1" },
    session,
    tools: [],
  })

  assert.equal(result.toolCalls?.[0]?.name, "valuya.get_marketplace_order")
  assert.equal(result.toolCalls?.[0]?.input?.orderId, "guard_order_1")
})

test("runtime explains when payment is confirmed but Alfies submission has not happened yet", async () => {
  const runtime = new SimpleCheckoutAgentRuntime()
  const session: ConversationSession = {
    conversationId: "c1",
    whatsappUserId: "49123",
    entries: [
      {
        role: "user",
        content: "status",
        createdAt: new Date(0).toISOString(),
      },
      {
        role: "tool",
        name: "valuya.get_entitlement",
        content: JSON.stringify({ active: true }),
        createdAt: new Date(0).toISOString(),
      },
      {
        role: "tool",
        name: "valuya.create_marketplace_order",
        content: JSON.stringify({ valuyaOrderId: "guard_order_1" }),
        createdAt: new Date(0).toISOString(),
      },
      {
        role: "tool",
        name: "valuya.get_marketplace_order",
        content: JSON.stringify({ txHash: "0xdef456", chainId: 8453 }),
        createdAt: new Date(0).toISOString(),
      },
    ],
    metadata: {
      currentCartSnapshot: {
        items: [{ sku: "alfies-1", name: "Milch", qty: 2, unit_price_cents: 219 }],
        total_cents: 438,
        currency: "EUR",
      },
    },
  }

  const result = await runtime.runTurn({
    linkedSubject: { protocolSubjectHeader: "app_user:1" },
    session,
    tools: [],
  })

  assert.match(String(result.reply || ""), /✓ Bezahlt/)
  assert.match(String(result.reply || ""), /On-chain Transaktion: 0xdef456/)
  assert.match(String(result.reply || ""), /polygonscan\.com\/tx\/0xdef456/)
  assert.match(String(result.reply || ""), /noch nicht an Alfies uebergeben/)
  assert.match(String(result.reply || ""), /noch nicht ausgeloest/)
  assert.match(String(result.reply || ""), /confirm/)
})

test("runtime prioritizes status over stale planner browse intent", async () => {
  const planner: ShoppingPlanner = {
    async plan() {
      return {
        action: "browse_products",
        confidence: 0.9,
        query: "Getraenke",
      }
    },
  }
  const runtime = new SimpleCheckoutAgentRuntime({ planner })
  const session: ConversationSession = {
    conversationId: "c1",
    whatsappUserId: "49123",
    entries: [
      {
        role: "user",
        content: "status",
        createdAt: new Date(0).toISOString(),
      },
      {
        role: "tool",
        name: "valuya.get_entitlement",
        content: JSON.stringify({ active: true }),
        createdAt: new Date(0).toISOString(),
      },
      {
        role: "tool",
        name: "valuya.create_marketplace_order",
        content: JSON.stringify({ valuyaOrderId: "guard_order_1" }),
        createdAt: new Date(0).toISOString(),
      },
      {
        role: "tool",
        name: "valuya.get_marketplace_order",
        content: JSON.stringify({ txHash: "0xstatus123", chainId: 8453 }),
        createdAt: new Date(0).toISOString(),
      },
    ],
    metadata: {
      pendingBrowseQuery: "getraenke",
      pendingBrowseType: "product",
    },
  }

  const result = await runtime.runTurn({
    linkedSubject: { protocolSubjectHeader: "app_user:1" },
    session,
    tools: [],
  })

  assert.match(String(result.reply || ""), /✓ Bezahlt/)
  assert.match(String(result.reply || ""), /0xstatus123/)
  assert.doesNotMatch(String(result.reply || ""), /Welche Produkte passen am besten/)
})

test("runtime uses persisted marketplace order id for status after a prior 1cent checkout turn", async () => {
  const runtime = new SimpleCheckoutAgentRuntime()
  const session: ConversationSession = {
    conversationId: "c1",
    whatsappUserId: "49123",
    entries: [
      {
        role: "user",
        content: "status",
        createdAt: new Date(0).toISOString(),
      },
      {
        role: "tool",
        name: "valuya.get_entitlement",
        content: JSON.stringify({ active: true }),
        createdAt: new Date(0).toISOString(),
      },
    ],
    metadata: {
      currentMarketplaceOrderId: "guard_order_from_1cent",
      currentCheckoutUrl: "https://pay.example/checkout/test-1cent",
    },
  }

  const result = await runtime.runTurn({
    linkedSubject: { protocolSubjectHeader: "app_user:1" },
    session,
    tools: [],
  })

  assert.equal(result.toolCalls?.[0]?.name, "valuya.get_marketplace_order")
  assert.equal(result.toolCalls?.[0]?.input?.orderId, "guard_order_from_1cent")
})

test("runtime does not treat confirm as a generic bundle acceptance without pending bundle items", async () => {
  const runtime = new SimpleCheckoutAgentRuntime()
  const session: ConversationSession = {
    conversationId: "c1",
    whatsappUserId: "49123",
    entries: [
      {
        role: "user",
        content: "confirm",
        createdAt: new Date(0).toISOString(),
      },
      {
        role: "tool",
        name: "cart.get_active",
        content: JSON.stringify({
          orderId: "ord_1",
          items: [{ sku: "alfies-1", name: "Milch", qty: 2, unit_price_cents: 219 }],
          totalCents: 438,
          currency: "EUR",
        }),
        createdAt: new Date(0).toISOString(),
      },
      {
        role: "tool",
        name: "valuya.get_entitlement",
        content: JSON.stringify({ active: true }),
        createdAt: new Date(0).toISOString(),
      },
    ],
    metadata: {
      pendingBundleProductIds: [],
    },
  }

  const result = await runtime.runTurn({
    linkedSubject: { protocolSubjectHeader: "app_user:1" },
    session,
    tools: [],
  })

  assert.equal(result.toolCalls?.[0]?.name, "alfies.dispatch_order")
  assert.doesNotMatch(String(result.reply || ""), /keine konkrete Einkaufsauswahl offen/)
})

test("runtime enriches backend dispatch confirmation with on-chain tx and email note once marketplace status exists", async () => {
  const runtime = new SimpleCheckoutAgentRuntime()
  const session: ConversationSession = {
    conversationId: "c1",
    whatsappUserId: "49123",
    entries: [
      {
        role: "user",
        content: "confirm",
        createdAt: new Date(0).toISOString(),
      },
      {
        role: "tool",
        name: "valuya.get_entitlement",
        content: JSON.stringify({ active: true }),
        createdAt: new Date(0).toISOString(),
      },
      {
        role: "tool",
        name: "valuya.create_marketplace_order",
        content: JSON.stringify({ valuyaOrderId: "guard_order_1" }),
        createdAt: new Date(0).toISOString(),
      },
      {
        role: "tool",
        name: "alfies.dispatch_order",
        content: JSON.stringify({ externalOrderId: "ord_backend_1" }),
        createdAt: new Date(0).toISOString(),
      },
      {
        role: "tool",
        name: "valuya.get_marketplace_order",
        content: JSON.stringify({ txHash: "0xdispatch123", chainId: 137 }),
        createdAt: new Date(0).toISOString(),
      },
    ],
    metadata: {
      currentCartSnapshot: {
        items: [{ sku: "alfies-1", name: "Milch", qty: 2, unit_price_cents: 219 }],
        total_cents: 438,
        currency: "EUR",
      },
    },
  }

  const result = await runtime.runTurn({
    linkedSubject: { protocolSubjectHeader: "app_user:1" },
    session,
    tools: [],
  })

  assert.match(String(result.reply || ""), /Die Bestellung wurde an das Alfies-Backend uebergeben/)
  assert.match(String(result.reply || ""), /Externe Bestellnummer: ord_backend_1/)
  assert.match(String(result.reply || ""), /On-chain Transaktion: 0xdispatch123/)
  assert.match(String(result.reply || ""), /polygonscan\.com\/tx\/0xdispatch123/)
  assert.match(String(result.reply || ""), /E-Mail\/CSV Versand wurde ausgeloest/)
})

test("runtime resolves product query before cart add", async () => {
  const runtime = new SimpleCheckoutAgentRuntime()
  const session: ConversationSession = {
    conversationId: "c1",
    whatsappUserId: "49123",
    entries: [
      {
        role: "user",
        content: "add milch",
        createdAt: new Date(0).toISOString(),
      },
    ],
    metadata: {},
  }

  const result = await runtime.runTurn({
    linkedSubject: { protocolSubjectHeader: "app_user:1" },
    session,
    tools: [],
  })

  assert.equal(result.toolCalls?.[0]?.name, "catalog.resolve_product_query")
})

test("runtime shows numbered options for ambiguous product results", async () => {
  const runtime = new SimpleCheckoutAgentRuntime()
  const session: ConversationSession = {
    conversationId: "c1",
    whatsappUserId: "49123",
    entries: [
      {
        role: "user",
        content: "add milch",
        createdAt: new Date(0).toISOString(),
      },
      {
        role: "tool",
        name: "catalog.resolve_product_query",
        content: JSON.stringify({
          kind: "ambiguous",
          options: [
            { productId: 1, title: "Bio Milch 1L" },
            { productId: 2, title: "Hafermilch 1L" },
          ],
        }),
        createdAt: new Date(0).toISOString(),
      },
    ],
    metadata: {},
  }

  const result = await runtime.runTurn({
    linkedSubject: { protocolSubjectHeader: "app_user:1" },
    session,
    tools: [],
  })

  assert.match(String(result.reply || ""), /1\. Bio Milch 1L/)
  assert.equal(Array.isArray(result.metadata?.pendingProductOptions), true)
})

test("runtime requests category browse for browse commands", async () => {
  const runtime = new SimpleCheckoutAgentRuntime()
  const session: ConversationSession = {
    conversationId: "c1",
    whatsappUserId: "49123",
    entries: [
      {
        role: "user",
        content: "browse drinks",
        createdAt: new Date(0).toISOString(),
      },
    ],
    metadata: {},
  }

  const result = await runtime.runTurn({
    linkedSubject: { protocolSubjectHeader: "app_user:1" },
    session,
    tools: [],
  })

  assert.equal(result.toolCalls?.[0]?.name, "catalog.browse_categories")
})

test("runtime shows all categories for german category requests", async () => {
  const runtime = new SimpleCheckoutAgentRuntime()
  const session: ConversationSession = {
    conversationId: "c1",
    whatsappUserId: "49123",
    entries: [
      {
        role: "user",
        content: "Zeige mir die Kategorien",
        createdAt: new Date(0).toISOString(),
      },
    ],
    metadata: {},
  }

  const result = await runtime.runTurn({
    linkedSubject: { protocolSubjectHeader: "app_user:1" },
    session,
    tools: [],
  })

  assert.equal(result.toolCalls?.[0]?.name, "catalog.browse_categories")
  assert.equal(result.toolCalls?.[0]?.input?.query, "")
})

test("runtime treats simple category words as natural browse requests", async () => {
  const runtime = new SimpleCheckoutAgentRuntime()
  const session: ConversationSession = {
    conversationId: "c1",
    whatsappUserId: "49123",
    entries: [
      {
        role: "user",
        content: "getraenke",
        createdAt: new Date(0).toISOString(),
      },
    ],
    metadata: {},
  }

  const result = await runtime.runTurn({
    linkedSubject: { protocolSubjectHeader: "app_user:1" },
    session,
    tools: [],
  })

  assert.equal(result.toolCalls?.[0]?.name, "catalog.browse_products")
  assert.equal(result.toolCalls?.[0]?.input?.query, "getraenke")
})

test("runtime maps baby shopping phrases to category browse", async () => {
  const planner: ShoppingPlanner = {
    async plan() {
      return {
        action: "browse_products",
        confidence: 0.9,
        query: "Babyprodukte",
      }
    },
  }
  const runtime = new SimpleCheckoutAgentRuntime({ planner })
  const session: ConversationSession = {
    conversationId: "c1",
    whatsappUserId: "49123",
    entries: [
      {
        role: "user",
        content: "Babyprodukte",
        createdAt: new Date(0).toISOString(),
      },
    ],
    metadata: {},
  }

  const result = await runtime.runTurn({
    linkedSubject: { protocolSubjectHeader: "app_user:1" },
    session,
    tools: [],
  })

  assert.equal(result.toolCalls?.[0]?.name, "catalog.browse_categories")
  assert.equal(result.toolCalls?.[0]?.input?.query, "baby")
})

test("runtime maps household shopping phrases to category browse", async () => {
  const runtime = new SimpleCheckoutAgentRuntime()
  const session: ConversationSession = {
    conversationId: "c1",
    whatsappUserId: "49123",
    entries: [
      {
        role: "user",
        content: "Ich brauche Sachen fuer den Haushalt",
        createdAt: new Date(0).toISOString(),
      },
    ],
    metadata: {},
  }

  const result = await runtime.runTurn({
    linkedSubject: { protocolSubjectHeader: "app_user:1" },
    session,
    tools: [],
  })

  assert.equal(result.toolCalls?.[0]?.name, "catalog.browse_categories")
  assert.equal(result.toolCalls?.[0]?.input?.query, "haushalt")
})

test("runtime extracts browse intent from natural shopping phrasing", async () => {
  const runtime = new SimpleCheckoutAgentRuntime()
  const session: ConversationSession = {
    conversationId: "c1",
    whatsappUserId: "49123",
    entries: [
      {
        role: "user",
        content: "Ich brauche Getraenke fuer heute abend",
        createdAt: new Date(0).toISOString(),
      },
    ],
    metadata: {},
  }

  const result = await runtime.runTurn({
    linkedSubject: { protocolSubjectHeader: "app_user:1" },
    session,
    tools: [],
  })

  assert.equal(result.toolCalls?.[0]?.name, "catalog.browse_products")
  assert.equal(result.toolCalls?.[0]?.input?.query, "getraenke")
})

test("runtime strips filler words from product follow-up queries", async () => {
  const runtime = new SimpleCheckoutAgentRuntime()
  const session: ConversationSession = {
    conversationId: "c1",
    whatsappUserId: "49123",
    entries: [
      {
        role: "user",
        content: "Hast du auch Apfelsaft",
        createdAt: new Date(0).toISOString(),
      },
    ],
    metadata: {},
  }

  const result = await runtime.runTurn({
    linkedSubject: { protocolSubjectHeader: "app_user:1" },
    session,
    tools: [],
  })

  assert.equal(result.toolCalls?.[0]?.name, "catalog.browse_products")
  assert.equal(result.toolCalls?.[0]?.input?.query, "apfelsaft")
})

test("runtime routes broad family browse requests to products", async () => {
  const runtime = new SimpleCheckoutAgentRuntime()
  const session: ConversationSession = {
    conversationId: "c1",
    whatsappUserId: "49123",
    entries: [
      {
        role: "user",
        content: "Zeig mir Snacks",
        createdAt: new Date(0).toISOString(),
      },
    ],
    metadata: {},
  }

  const result = await runtime.runTurn({
    linkedSubject: { protocolSubjectHeader: "app_user:1" },
    session,
    tools: [],
  })

  assert.equal(result.toolCalls?.[0]?.name, "catalog.browse_products")
  assert.equal(result.toolCalls?.[0]?.input?.query, "snacks")
})

test("runtime paginates browse results when the user asks for more", async () => {
  const runtime = new SimpleCheckoutAgentRuntime()
  const session: ConversationSession = {
    conversationId: "c1",
    whatsappUserId: "49123",
    entries: [
      {
        role: "user",
        content: "gibts noch mehr?",
        createdAt: new Date(0).toISOString(),
      },
    ],
    metadata: {
      pendingBrowseType: "product",
      pendingBrowseQuery: "pizza",
      pendingBrowsePage: 0,
      pendingProductOptions: [
        { label: "Pizza Sauce", value: "Pizza Sauce", productId: 1 },
      ],
    },
  }

  const result = await runtime.runTurn({
    linkedSubject: { protocolSubjectHeader: "app_user:1" },
    session,
    tools: [],
  })

  assert.equal(result.toolCalls?.[0]?.name, "catalog.browse_products")
  assert.equal(result.toolCalls?.[0]?.input?.query, "pizza")
  assert.equal(result.toolCalls?.[0]?.input?.page, 1)
})

test("runtime paginates browse results for 'zeige mir mehr'", async () => {
  const runtime = new SimpleCheckoutAgentRuntime()
  const session: ConversationSession = {
    conversationId: "c1",
    whatsappUserId: "49123",
    entries: [
      {
        role: "user",
        content: "Zeige mir mehr",
        createdAt: new Date(0).toISOString(),
      },
    ],
    metadata: {
      pendingBrowseType: "product",
      pendingBrowseQuery: "bier",
      pendingBrowsePage: 0,
      pendingProductOptions: [
        { label: "Egger Maerzen", value: "Egger Maerzen", productId: 1 },
      ],
    },
  }

  const result = await runtime.runTurn({
    linkedSubject: { protocolSubjectHeader: "app_user:1" },
    session,
    tools: [],
  })

  assert.equal(result.toolCalls?.[0]?.name, "catalog.browse_products")
  assert.equal(result.toolCalls?.[0]?.input?.query, "bier")
  assert.equal(result.toolCalls?.[0]?.input?.page, 1)
})

test("runtime paginates browse results for 'sind das alle - oder gibt es noch mehr'", async () => {
  const runtime = new SimpleCheckoutAgentRuntime()
  const session: ConversationSession = {
    conversationId: "c1",
    whatsappUserId: "49123",
    entries: [
      {
        role: "user",
        content: "Sind das alle - oder gibt es noch mehr",
        createdAt: new Date(0).toISOString(),
      },
    ],
    metadata: {
      pendingBrowseType: "product",
      pendingBrowseQuery: "dr oetker pizza",
      pendingBrowsePage: 0,
      lastShoppingKind: "product",
      lastShoppingQuery: "dr oetker pizza",
    },
  }

  const result = await runtime.runTurn({
    linkedSubject: { protocolSubjectHeader: "app_user:1" },
    session,
    tools: [],
  })

  assert.equal(result.toolCalls?.[0]?.name, "catalog.browse_products")
  assert.equal(result.toolCalls?.[0]?.input?.query, "dr oetker pizza")
  assert.equal(result.toolCalls?.[0]?.input?.page, 1)
})

test("runtime paginates browse results for 'Kannst du mir alle zeigen'", async () => {
  const runtime = new SimpleCheckoutAgentRuntime()
  const session: ConversationSession = {
    conversationId: "c1",
    whatsappUserId: "49123",
    entries: [
      {
        role: "user",
        content: "Kannst du mir alle zeigen",
        createdAt: new Date(0).toISOString(),
      },
    ],
    metadata: {
      pendingBrowseType: "product",
      pendingBrowseQuery: "dr oetker pizza",
      pendingBrowsePage: 1,
      lastShoppingKind: "product",
      lastShoppingQuery: "dr oetker pizza",
    },
  }

  const result = await runtime.runTurn({
    linkedSubject: { protocolSubjectHeader: "app_user:1" },
    session,
    tools: [],
  })

  assert.equal(result.toolCalls?.[0]?.name, "catalog.browse_products")
  assert.equal(result.toolCalls?.[0]?.input?.query, "dr oetker pizza")
  assert.equal(result.toolCalls?.[0]?.input?.page, 0)
  assert.equal(result.toolCalls?.[0]?.input?.limit, 100)
})

test("runtime uses a larger limit when the user explicitly asks to see all matches", async () => {
  const planner: ShoppingPlanner = {
    async plan() {
      return {
        action: "browse_products",
        confidence: 0.9,
        query: "Dr. Oetker",
      }
    },
  }
  const runtime = new SimpleCheckoutAgentRuntime({ planner })
  const session: ConversationSession = {
    conversationId: "c1",
    whatsappUserId: "49123",
    entries: [
      {
        role: "user",
        content: "Zeigst du mir bitte alle von Dr. Oetker?",
        createdAt: new Date(0).toISOString(),
      },
    ],
    metadata: {
      lastShoppingKind: "product",
      lastShoppingQuery: "pizza",
      pendingBrowseType: "product",
      pendingBrowseQuery: "pizza",
      pendingBrowsePage: 0,
    },
  }

  const result = await runtime.runTurn({
    linkedSubject: { protocolSubjectHeader: "app_user:1" },
    session,
    tools: [],
  })

  assert.equal(result.toolCalls?.[0]?.name, "catalog.browse_products")
  assert.equal(result.toolCalls?.[0]?.input?.query, "dr oetker pizza")
  assert.equal(result.toolCalls?.[0]?.input?.limit, 100)
  assert.equal(result.toolCalls?.[0]?.input?.page, 0)
})

test("runtime treats 'Zeige mir alle Biersorten' as a product browse for bier", async () => {
  const planner: ShoppingPlanner = {
    async plan() {
      return {
        action: "browse_products",
        confidence: 0.9,
        query: "Biersorten",
      }
    },
  }
  const runtime = new SimpleCheckoutAgentRuntime({ planner })
  const session: ConversationSession = {
    conversationId: "c1",
    whatsappUserId: "49123",
    entries: [
      {
        role: "user",
        content: "Zeige mir alle Biersorten",
        createdAt: new Date(0).toISOString(),
      },
    ],
    metadata: {},
  }

  const result = await runtime.runTurn({
    linkedSubject: { protocolSubjectHeader: "app_user:1" },
    session,
    tools: [],
  })

  assert.equal(result.toolCalls?.[0]?.name, "catalog.browse_products")
  assert.equal(result.toolCalls?.[0]?.input?.query, "bier")
  assert.equal(result.toolCalls?.[0]?.input?.limit, 100)
})

test("runtime canonicalizes 'Pizzasorten' to pizza in explicit all-browse requests", async () => {
  const planner: ShoppingPlanner = {
    async plan() {
      return {
        action: "browse_products",
        confidence: 0.9,
        query: "Pizzasorten",
      }
    },
  }
  const runtime = new SimpleCheckoutAgentRuntime({ planner })
  const session: ConversationSession = {
    conversationId: "c1",
    whatsappUserId: "49123",
    entries: [
      {
        role: "user",
        content: "Zeige alle Pizzasorten",
        createdAt: new Date(0).toISOString(),
      },
    ],
    metadata: {},
  }

  const result = await runtime.runTurn({
    linkedSubject: { protocolSubjectHeader: "app_user:1" },
    session,
    tools: [],
  })

  assert.equal(result.toolCalls?.[0]?.name, "catalog.browse_products")
  assert.equal(result.toolCalls?.[0]?.input?.query, "pizza")
  assert.equal(result.toolCalls?.[0]?.input?.limit, 100)
})

test("runtime does not treat 'Zeige alle' as a numeric choice even if planner suggests choose_option", async () => {
  const planner: ShoppingPlanner = {
    async plan() {
      return {
        action: "choose_option",
        confidence: 0.9,
        selectionIndex: 6,
      }
    },
  }
  const runtime = new SimpleCheckoutAgentRuntime({ planner })
  const session: ConversationSession = {
    conversationId: "c1",
    whatsappUserId: "49123",
    entries: [
      {
        role: "user",
        content: "Zeige alle",
        createdAt: new Date(0).toISOString(),
      },
    ],
    metadata: {
      pendingBrowseType: "category",
      pendingBrowseQuery: "bier",
      pendingBrowsePage: 0,
      pendingBrowseLimit: 6,
      pendingProductOptions: [
        { label: "Alkoholfreie Biere & Radler", value: "Alkoholfreie Biere & Radler" },
        { label: "Bier & Cider Pakete", value: "Bier & Cider Pakete" },
        { label: "Bierspezialitaeten", value: "Bierspezialitaeten" },
        { label: "Craft Biere", value: "Craft Biere" },
        { label: "Weissbier", value: "Weissbier" },
        { label: "Lagerbier", value: "Lagerbier" },
      ],
    },
  }

  const result = await runtime.runTurn({
    linkedSubject: { protocolSubjectHeader: "app_user:1" },
    session,
    tools: [],
  })

  assert.equal(result.toolCalls?.[0]?.name, "catalog.browse_categories")
  assert.equal(result.toolCalls?.[0]?.input?.query, "bier")
  assert.equal(result.toolCalls?.[0]?.input?.limit, 100)
})

test("runtime ignores planner quantity updates without a target query", async () => {
  const planner: ShoppingPlanner = {
    async plan() {
      return {
        action: "set_item_quantity",
        confidence: 1,
        query: "",
        quantity: 4,
      }
    },
  }
  const runtime = new SimpleCheckoutAgentRuntime({ planner })
  const session: ConversationSession = {
    conversationId: "c1",
    whatsappUserId: "49123",
    entries: [
      {
        role: "user",
        content: "4x 16",
        createdAt: new Date(0).toISOString(),
      },
    ],
    metadata: {},
  }

  const result = await runtime.runTurn({
    linkedSubject: { protocolSubjectHeader: "app_user:1" },
    session,
    tools: [],
  })

  assert.equal(result.toolCalls, undefined)
  assert.match(result.reply || "", /menge aendern willst/i)
})

test("runtime ignores planner add-item guesses for bare family browse messages like 'Reis'", async () => {
  const planner: ShoppingPlanner = {
    async plan() {
      return {
        action: "add_item",
        confidence: 0.95,
        query: "Reis",
      }
    },
  }
  const runtime = new SimpleCheckoutAgentRuntime({ planner })
  const session: ConversationSession = {
    conversationId: "c1",
    whatsappUserId: "49123",
    entries: [
      {
        role: "user",
        content: "Reis",
        createdAt: new Date(0).toISOString(),
      },
    ],
    metadata: {},
  }

  const result = await runtime.runTurn({
    linkedSubject: { protocolSubjectHeader: "app_user:1" },
    session,
    tools: [],
  })

  assert.equal(result.toolCalls?.[0]?.name, "catalog.browse_products")
  assert.equal(result.toolCalls?.[0]?.input?.query, "reis")
 })

test("runtime treats category-like resolve-product ambiguities as browse selection instead of cart mutation", async () => {
  const runtime = new SimpleCheckoutAgentRuntime({
    planner: {
      async plan() {
        return {
          action: "add_item",
          confidence: 0.95,
          query: "Reis",
        }
      },
    },
  })
  const session: ConversationSession = {
    conversationId: "c1",
    whatsappUserId: "49123",
    entries: [
      {
        role: "user",
        content: "Reis",
        createdAt: new Date(0).toISOString(),
      },
      {
        role: "tool",
        name: "catalog.resolve_product_query",
        toolCallId: "tc_1",
        content: JSON.stringify({
          kind: "ambiguous",
          options: [
            { title: "Reis & Maiswaffeln", label: "Reis & Maiswaffeln", value: "Reis & Maiswaffeln" },
            { title: "Reis, Getreide & Co", label: "Reis, Getreide & Co", value: "Reis, Getreide & Co" },
          ],
        }),
        createdAt: new Date(0).toISOString(),
      },
    ],
    metadata: {},
  }

  const result = await runtime.runTurn({
    linkedSubject: { protocolSubjectHeader: "app_user:1" },
    session,
    tools: [],
  })

  assert.match(String(result.reply || ""), /welche Variante du meinst/i)
  assert.equal(result.metadata?.pendingMutation, undefined)
  assert.equal(result.metadata?.pendingBrowseType, "category")
  assert.equal(Array.isArray(result.metadata?.pendingProductOptions), true)
})

test("runtime prioritizes planner quantity updates over browse parsing for messages like 'Bitte 3x Rama Cremefine'", async () => {
  const planner: ShoppingPlanner = {
    async plan() {
      return {
        action: "set_item_quantity",
        confidence: 0.95,
        query: "Rama Cremefine zum Kochen 15%",
        quantity: 3,
      }
    },
  }
  const runtime = new SimpleCheckoutAgentRuntime({ planner })
  const session: ConversationSession = {
    conversationId: "c1",
    whatsappUserId: "49123",
    entries: [
      {
        role: "user",
        content: "Bitte 3x Rama Cremefine",
        createdAt: new Date(0).toISOString(),
      },
    ],
    metadata: {
      currentCartSnapshot: {
        items: [{ sku: "rama-1", name: "Rama Cremefine zum Kochen 15%", qty: 1, unit_price_cents: 135 }],
        total_cents: 135,
        currency: "EUR",
      },
    },
  }

  const result = await runtime.runTurn({
    linkedSubject: { protocolSubjectHeader: "app_user:1" },
    session,
    tools: [],
  })

  assert.equal(result.toolCalls?.[0]?.name, "catalog.resolve_product_query")
  assert.equal(result.toolCalls?.[0]?.input?.query, "Rama Cremefine zum Kochen 15%")
})

test("runtime blocks ambiguous quantity shorthand like '4x3'", async () => {
  const runtime = new SimpleCheckoutAgentRuntime()
  const session: ConversationSession = {
    conversationId: "c1",
    whatsappUserId: "49123",
    entries: [
      {
        role: "user",
        content: "4x3",
        createdAt: new Date(0).toISOString(),
      },
    ],
    metadata: {},
  }

  const result = await runtime.runTurn({
    linkedSubject: { protocolSubjectHeader: "app_user:1" },
    session,
    tools: [],
  })

  assert.equal(result.toolCalls, undefined)
  assert.match(result.reply || "", /menge aendern willst/i)
})

test("runtime treats 'Babyprodukte' as a category browse", async () => {
  const planner: ShoppingPlanner = {
    async plan() {
      return {
        action: "browse_products",
        confidence: 0.9,
        query: "Babyprodukte",
      }
    },
  }
  const runtime = new SimpleCheckoutAgentRuntime({ planner })
  const session: ConversationSession = {
    conversationId: "c1",
    whatsappUserId: "49123",
    entries: [
      {
        role: "user",
        content: "Babyprodukte",
        createdAt: new Date(0).toISOString(),
      },
    ],
    metadata: {},
  }

  const result = await runtime.runTurn({
    linkedSubject: { protocolSubjectHeader: "app_user:1" },
    session,
    tools: [],
  })

  assert.equal(result.toolCalls?.[0]?.name, "catalog.browse_categories")
  assert.equal(result.toolCalls?.[0]?.input?.query, "baby")
})

test("runtime routes 'Zeige alle Kategorien' to category browse with large limit", async () => {
  const runtime = new SimpleCheckoutAgentRuntime()
  const session: ConversationSession = {
    conversationId: "c1",
    whatsappUserId: "49123",
    entries: [
      {
        role: "user",
        content: "Zeige alle Kategorien",
        createdAt: new Date(0).toISOString(),
      },
    ],
    metadata: {
      pendingBrowseType: "product",
      pendingBrowseQuery: "pizza",
      pendingBrowsePage: 1,
      pendingBrowseLimit: 6,
    },
  }

  const result = await runtime.runTurn({
    linkedSubject: { protocolSubjectHeader: "app_user:1" },
    session,
    tools: [],
  })

  assert.equal(result.toolCalls?.[0]?.name, "catalog.browse_categories")
  assert.equal(result.toolCalls?.[0]?.input?.query, "")
  assert.equal(result.toolCalls?.[0]?.input?.limit, 100)
})

test("runtime uses 20 as the default browse limit for normal product searches", async () => {
  const planner: ShoppingPlanner = {
    async plan() {
      return {
        action: "browse_products",
        confidence: 0.9,
        query: "Pizza",
      }
    },
  }
  const runtime = new SimpleCheckoutAgentRuntime({ planner })
  const session: ConversationSession = {
    conversationId: "c1",
    whatsappUserId: "49123",
    entries: [
      {
        role: "user",
        content: "Pizza",
        createdAt: new Date(0).toISOString(),
      },
    ],
    metadata: {},
  }

  const result = await runtime.runTurn({
    linkedSubject: { protocolSubjectHeader: "app_user:1" },
    session,
    tools: [],
  })

  assert.equal(result.toolCalls?.[0]?.name, "catalog.browse_products")
  assert.equal(result.toolCalls?.[0]?.input?.query, "pizza")
  assert.equal(result.toolCalls?.[0]?.input?.limit, 20)
})

test("runtime indicates when a browse list is complete", async () => {
  const runtime = new SimpleCheckoutAgentRuntime()
  const session: ConversationSession = {
    conversationId: "c1",
    whatsappUserId: "49123",
    entries: [
      {
        role: "user",
        content: "Pizza",
        createdAt: new Date(0).toISOString(),
      },
      {
        role: "tool",
        name: "catalog.browse_products",
        content: JSON.stringify({
          prompt: "Welche Produkte passen am besten zu 'pizza'?",
          options: [
            { label: "Produkt A", value: "Produkt A", productId: 1 },
            { label: "Produkt B", value: "Produkt B", productId: 2 },
          ],
          hasMore: false,
        }),
        createdAt: new Date(1).toISOString(),
      },
    ],
    metadata: {
      pendingBrowseType: "product",
      pendingBrowseQuery: "pizza",
    },
  }

  const result = await runtime.runTurn({
    linkedSubject: { protocolSubjectHeader: "app_user:1" },
    session,
    tools: [],
  })

  assert.match(result.reply || "", /vollstaendige liste/i)
})

test("runtime does not treat 'zeige mir mehr' as a fresh search without active browse state", async () => {
  const runtime = new SimpleCheckoutAgentRuntime({
    planner: {
      async plan() {
        return {
          action: "unknown",
          confidence: 0.9,
        }
      },
    },
  })
  const session: ConversationSession = {
    conversationId: "c1",
    whatsappUserId: "49123",
    entries: [
      {
        role: "user",
        content: "Zeige mir mehr",
        createdAt: new Date(0).toISOString(),
      },
    ],
    metadata: {},
  }

  const result = await runtime.runTurn({
    linkedSubject: { protocolSubjectHeader: "app_user:1" },
    session,
    tools: [],
  })

  assert.match(String(result.reply || ""), /keine offene Liste/i)
  assert.equal(result.toolCalls, undefined)
})

test("runtime handles cancel as flow control, not catalog search", async () => {
  const runtime = new SimpleCheckoutAgentRuntime({
    planner: {
      async plan() {
        return {
          action: "unknown",
          confidence: 0.9,
        }
      },
    },
  })
  const session: ConversationSession = {
    conversationId: "c1",
    whatsappUserId: "49123",
    entries: [
      {
        role: "user",
        content: "cancel",
        createdAt: new Date(0).toISOString(),
      },
    ],
    metadata: {
      pendingBrowseQuery: "pizza",
      pendingBrowsePage: 1,
    },
  }

  const result = await runtime.runTurn({
    linkedSubject: { protocolSubjectHeader: "app_user:1" },
    session,
    tools: [],
  })

  assert.match(String(result.reply || ""), /stoppe den aktuellen Auswahl-Flow/i)
  assert.equal(result.toolCalls, undefined)
})

test("runtime ignores stale planner recipe guesses without recipe context", async () => {
  const runtime = new SimpleCheckoutAgentRuntime({
    planner: {
      async plan() {
        return {
          action: "refine_recipe",
          confidence: 0.9,
          query: "Paella",
          modifier: "schnell, kindgerecht",
          servings: 4,
        }
      },
    },
  })
  const session: ConversationSession = {
    conversationId: "c1",
    whatsappUserId: "49123",
    entries: [
      {
        role: "user",
        content: "Ich moechte ein schnelles Gericht fuer Kinder vier Personen",
        createdAt: new Date(0).toISOString(),
      },
    ],
    metadata: {},
  }

  const result = await runtime.runTurn({
    linkedSubject: { protocolSubjectHeader: "app_user:1" },
    session,
    tools: [],
  })

  assert.match(String(result.reply || ""), /beim Einkaufen und Checkout helfen/i)
})

test("runtime prioritizes a fresh recipe request over stale browse refinement", async () => {
  const runtime = new SimpleCheckoutAgentRuntime({
    planner: {
      async plan() {
        return {
          action: "recipe",
          confidence: 0.9,
          query: "vegetarische Pasta",
        }
      },
    },
  })
  const session: ConversationSession = {
    conversationId: "c1",
    whatsappUserId: "49123",
    entries: [
      {
        role: "user",
        content: "vegetarische Pasta",
        createdAt: new Date(0).toISOString(),
      },
    ],
    metadata: {
      lastShoppingKind: "product",
      lastShoppingQuery: "apfelsaft",
      pendingBrowseQuery: "apfelsaft",
      pendingBrowseType: "product",
    },
  }

  const result = await runtime.runTurn({
    linkedSubject: { protocolSubjectHeader: "app_user:1" },
    session,
    tools: [],
  })

  assert.equal(result.toolCalls?.[0]?.name, "catalog.recipe_to_products")
  assert.equal(result.toolCalls?.[0]?.input?.query, "vegetarische Pasta")
})

test("runtime treats recipe-like messages as conversational recipe requests", async () => {
  const runtime = new SimpleCheckoutAgentRuntime()
  const session: ConversationSession = {
    conversationId: "c1",
    whatsappUserId: "49123",
    entries: [
      {
        role: "user",
        content: "Ich moechte Paella machen heute",
        createdAt: new Date(0).toISOString(),
      },
    ],
    metadata: {},
  }

  const result = await runtime.runTurn({
    linkedSubject: { protocolSubjectHeader: "app_user:1" },
    session,
    tools: [],
  })

  assert.equal(result.toolCalls?.[0]?.name, "catalog.recipe_to_products")
})

test("runtime treats ingredient-based cooking requests as recipe-style requests", async () => {
  const runtime = new SimpleCheckoutAgentRuntime({
    planner: {
      async plan() {
        return {
          action: "recipe",
          confidence: 0.9,
          query: "Kartoffeln mit Gemuese und Fisch fuer 4",
        }
      },
    },
  })
  const session: ConversationSession = {
    conversationId: "c1",
    whatsappUserId: "49123",
    entries: [
      {
        role: "user",
        content: "Kartoffeln mit Gemuese und Fisch fuer 4",
        createdAt: new Date(0).toISOString(),
      },
    ],
    metadata: {},
  }

  const result = await runtime.runTurn({
    linkedSubject: { protocolSubjectHeader: "app_user:1" },
    session,
    tools: [],
  })

  assert.equal(result.toolCalls?.[0]?.name, "catalog.meal_candidates")
  assert.equal(result.toolCalls?.[0]?.input?.query, "Kartoffeln mit Gemuese und Fisch fuer 4")
})

test("runtime greets naturally on the first hello", async () => {
  const runtime = new SimpleCheckoutAgentRuntime()
  const session: ConversationSession = {
    conversationId: "c1",
    whatsappUserId: "49123",
    entries: [
      {
        role: "user",
        content: "Hallo",
        createdAt: new Date(0).toISOString(),
      },
    ],
    metadata: {},
  }

  const result = await runtime.runTurn({
    linkedSubject: { protocolSubjectHeader: "app_user:1" },
    session,
    tools: [],
  })

  assert.match(String(result.reply || ""), /Alfies Concierge/)
  assert.match(String(result.reply || ""), /Paella/)
})

test("runtime adjusts a pending recipe when the user specifies servings", async () => {
  const runtime = new SimpleCheckoutAgentRuntime()
  const session: ConversationSession = {
    conversationId: "c1",
    whatsappUserId: "49123",
    entries: [
      {
        role: "user",
        content: "fuer 4",
        createdAt: new Date(0).toISOString(),
      },
    ],
    metadata: {
      pendingRecipeQuery: "Paella",
    },
  }

  const result = await runtime.runTurn({
    linkedSubject: { protocolSubjectHeader: "app_user:1" },
    session,
    tools: [],
  })

  assert.equal(result.toolCalls?.[0]?.name, "catalog.recipe_to_products")
  assert.equal(result.toolCalls?.[0]?.input?.query, "Paella fuer 4")
})

test("runtime does not treat a bare number as a product query without pending options", async () => {
  const runtime = new SimpleCheckoutAgentRuntime()
  const session: ConversationSession = {
    conversationId: "c1",
    whatsappUserId: "49123",
    entries: [
      {
        role: "user",
        content: "3",
        createdAt: new Date(0).toISOString(),
      },
    ],
    metadata: {},
  }

  const result = await runtime.runTurn({
    linkedSubject: { protocolSubjectHeader: "app_user:1" },
    session,
    tools: [],
  })

  assert.match(String(result.reply || ""), /keine offene nummerierte Auswahl/i)
  assert.equal(result.toolCalls, undefined)
})

test("runtime refines recipe requests with conversational modifiers", async () => {
  const runtime = new SimpleCheckoutAgentRuntime()
  const session: ConversationSession = {
    conversationId: "c1",
    whatsappUserId: "49123",
    entries: [
      {
        role: "user",
        content: "vegetarisch",
        createdAt: new Date(0).toISOString(),
      },
    ],
    metadata: {
      pendingRecipeQuery: "Paella",
      lastShoppingKind: "recipe",
      lastShoppingQuery: "Paella",
    },
  }

  const result = await runtime.runTurn({
    linkedSubject: { protocolSubjectHeader: "app_user:1" },
    session,
    tools: [],
  })

  assert.equal(result.toolCalls?.[0]?.name, "catalog.recipe_to_products")
  assert.equal(result.toolCalls?.[0]?.input?.query, "Paella vegetarisch")
})

test("runtime refines the last browse with modifier phrases", async () => {
  const runtime = new SimpleCheckoutAgentRuntime()
  const session: ConversationSession = {
    conversationId: "c1",
    whatsappUserId: "49123",
    entries: [
      {
        role: "user",
        content: "ohne alkohol",
        createdAt: new Date(0).toISOString(),
      },
    ],
    metadata: {
      lastShoppingKind: "category",
      lastShoppingQuery: "getraenke",
    },
  }

  const result = await runtime.runTurn({
    linkedSubject: { protocolSubjectHeader: "app_user:1" },
    session,
    tools: [],
  })

  assert.equal(result.toolCalls?.[0]?.name, "catalog.browse_products")
  assert.equal(result.toolCalls?.[0]?.input?.query, "alkoholfrei getraenke")
  assert.equal(result.toolCalls?.[0]?.input?.category, "getraenke")
})

test("runtime understands german add-to-cart phrasing", async () => {
  const runtime = new SimpleCheckoutAgentRuntime()
  const session: ConversationSession = {
    conversationId: "c1",
    whatsappUserId: "49123",
    entries: [
      {
        role: "user",
        content: "Pack 2 Bio-Milch dazu",
        createdAt: new Date(0).toISOString(),
      },
    ],
    metadata: {},
  }

  const result = await runtime.runTurn({
    linkedSubject: { protocolSubjectHeader: "app_user:1" },
    session,
    tools: [],
  })

  assert.equal(result.toolCalls?.[0]?.name, "catalog.resolve_product_query")
  assert.equal(result.toolCalls?.[0]?.input?.query, "bio-milch")
})

test("runtime uses planner output for natural browse requests", async () => {
  const planner: ShoppingPlanner = {
    async plan() {
      return {
        action: "browse_categories",
        confidence: 0.93,
        query: "",
      }
    },
  }
  const runtime = new SimpleCheckoutAgentRuntime({ planner })
  const session: ConversationSession = {
    conversationId: "c1",
    whatsappUserId: "49123",
    entries: [
      {
        role: "user",
        content: "Was kann ich heute so alles einkaufen?",
        createdAt: new Date(0).toISOString(),
      },
    ],
    metadata: {},
  }

  const result = await runtime.runTurn({
    linkedSubject: { protocolSubjectHeader: "app_user:1" },
    session,
    tools: [],
  })

  assert.equal(result.toolCalls?.[0]?.name, "catalog.browse_categories")
  assert.equal(result.metadata?.plannerAction, "browse_categories")
})

test("runtime canonicalizes planner browse queries like biersorten to bier", async () => {
  const planner: ShoppingPlanner = {
    async plan() {
      return {
        action: "browse_products",
        confidence: 0.9,
        query: "Biersorten",
      }
    },
  }
  const runtime = new SimpleCheckoutAgentRuntime({ planner })
  const session: ConversationSession = {
    conversationId: "c1",
    whatsappUserId: "49123",
    entries: [
      {
        role: "user",
        content: "ich brauche noch Getränke - kannst du mir die Biersorten zeigen, die ihr habt?",
        createdAt: new Date(0).toISOString(),
      },
    ],
    metadata: {},
  }

  const result = await runtime.runTurn({
    linkedSubject: { protocolSubjectHeader: "app_user:1" },
    session,
    tools: [],
  })

  assert.equal(result.toolCalls?.[0]?.name, "catalog.browse_products")
  assert.equal(result.toolCalls?.[0]?.input?.query, "bier")
})

test("runtime keeps the current browse topic for brand follow-ups like 'mehr von Dr. Oetker'", async () => {
  const planner: ShoppingPlanner = {
    async plan() {
      return {
        action: "browse_products",
        confidence: 0.9,
        query: "Dr. Oetker",
      }
    },
  }
  const runtime = new SimpleCheckoutAgentRuntime({ planner })
  const session: ConversationSession = {
    conversationId: "c1",
    whatsappUserId: "49123",
    entries: [
      {
        role: "user",
        content: "Hast du noch mehr von Dr. Oetker?",
        createdAt: new Date(0).toISOString(),
      },
    ],
    metadata: {
      lastShoppingKind: "product",
      lastShoppingQuery: "pizza",
      pendingBrowseType: "product",
      pendingBrowseQuery: "pizza",
      pendingBrowsePage: 0,
    },
  }

  const result = await runtime.runTurn({
    linkedSubject: { protocolSubjectHeader: "app_user:1" },
    session,
    tools: [],
  })

  assert.equal(result.toolCalls?.[0]?.name, "catalog.browse_products")
  assert.equal(result.toolCalls?.[0]?.input?.query, "dr oetker pizza")
})

test("runtime sends structured state and recent turns to the planner", async () => {
  let capturedContextSummary = ""
  const planner: ShoppingPlanner = {
    async plan(args) {
      capturedContextSummary = args.contextSummary || ""
      return {
        action: "browse_categories",
        confidence: 0.93,
        query: "",
      }
    },
  }
  const runtime = new SimpleCheckoutAgentRuntime({ planner })
  const session: ConversationSession = {
    conversationId: "c1",
    whatsappUserId: "49123",
    entries: [
      { role: "user", content: "Pizza", createdAt: new Date(0).toISOString() },
      { role: "assistant", content: "Welche Produkte passen am besten zu 'pizza'?", createdAt: new Date(0).toISOString() },
      { role: "user", content: "Gibts noch mehr?", createdAt: new Date(0).toISOString() },
      { role: "assistant", content: "Hier sind weitere Pizza-Produkte.", createdAt: new Date(0).toISOString() },
      { role: "user", content: "Was kann ich heute so alles einkaufen?", createdAt: new Date(0).toISOString() },
    ],
    metadata: {
      pendingBrowseType: "product",
      pendingBrowseQuery: "pizza",
      pendingBrowsePage: 1,
      lastShoppingKind: "product",
      lastShoppingQuery: "pizza",
      pendingProductOptions: [{ productId: 1, label: "Pizza Sauce", value: "Pizza Sauce" }],
      currentCartSnapshot: {
        items: [{ sku: "alfies-1", name: "Pizza Sauce", qty: 1, unit_price_cents: 399 }],
      },
      currentOrderId: "ord_1",
    },
  }

  await runtime.runTurn({
    linkedSubject: { protocolSubjectHeader: "app_user:1" },
    session,
    tools: [],
  })

  assert.match(capturedContextSummary, /state:/)
  assert.match(capturedContextSummary, /pending_browse_type: product/)
  assert.match(capturedContextSummary, /last_shopping_query: pizza/)
  assert.match(capturedContextSummary, /cart_item_count: 1/)
  assert.match(capturedContextSummary, /recent_turns:/)
  assert.match(capturedContextSummary, /assistant: Welche Produkte passen am besten zu 'pizza'/)
})

test("runtime uses planner output for natural recipe refinement", async () => {
  const planner: ShoppingPlanner = {
    async plan() {
      return {
        action: "refine_recipe",
        confidence: 0.9,
        modifier: "vegetarisch",
      }
    },
  }
  const runtime = new SimpleCheckoutAgentRuntime({ planner })
  const session: ConversationSession = {
    conversationId: "c1",
    whatsappUserId: "49123",
    entries: [
      {
        role: "user",
        content: "lieber vegetarisch",
        createdAt: new Date(0).toISOString(),
      },
    ],
    metadata: {
      pendingRecipeQuery: "Paella",
      lastShoppingKind: "recipe",
      lastShoppingQuery: "Paella",
    },
  }

  const result = await runtime.runTurn({
    linkedSubject: { protocolSubjectHeader: "app_user:1" },
    session,
    tools: [],
  })

  assert.equal(result.toolCalls?.[0]?.name, "catalog.recipe_to_products")
  assert.equal(result.toolCalls?.[0]?.input?.query, "Paella vegetarisch")
})

test("runtime does not offer 'alles' when recipe mapping found no concrete products", async () => {
  const runtime = new SimpleCheckoutAgentRuntime()
  const session: ConversationSession = {
    conversationId: "c1",
    whatsappUserId: "49123",
    entries: [
      {
        role: "user",
        content: "Ich moechte Paella machen",
        createdAt: new Date(0).toISOString(),
      },
      {
        role: "tool",
        name: "catalog.recipe_to_products",
        content: JSON.stringify({
          recipeTitle: "Paella",
          options: [],
          unresolvedIngredients: ["reis", "paprika", "erbsen"],
        }),
        createdAt: new Date(0).toISOString(),
      },
    ],
    metadata: {},
  }

  const result = await runtime.runTurn({
    linkedSubject: { protocolSubjectHeader: "app_user:1" },
    session,
    tools: [],
  })

  assert.doesNotMatch(String(result.reply || ""), /antworte einfach mit 'alles'/i)
  assert.match(String(result.reply || ""), /vegetarisch|Meeresfruechten/i)
})

test("runtime requests grounded meal candidates for meal-style shopping prompts", async () => {
  const planner: ShoppingPlanner = {
    async plan() {
      return {
        action: "recipe",
        confidence: 0.95,
        query: "Gemuese mit Fisch",
      }
    },
  }
  const runtime = new SimpleCheckoutAgentRuntime({ planner })
  const session: ConversationSession = {
    conversationId: "c1",
    whatsappUserId: "49123",
    entries: [
      {
        role: "user",
        content: "Gemuese mit Fisch",
        createdAt: new Date(0).toISOString(),
      },
    ],
    metadata: {},
  }

  const result = await runtime.runTurn({
    linkedSubject: { protocolSubjectHeader: "app_user:1" },
    session,
    tools: [],
  })

  assert.equal(result.toolCalls?.[0]?.name, "catalog.meal_candidates")
  assert.equal(result.toolCalls?.[0]?.input?.query, "Gemuese mit Fisch")
})

test("runtime uses grounded meal candidates for named dishes like tortellini a la panna", async () => {
  const planner: ShoppingPlanner = {
    async plan() {
      return {
        action: "recipe",
        confidence: 0.95,
        query: "Tortellini a la panna",
      }
    },
  }
  const runtime = new SimpleCheckoutAgentRuntime({ planner })
  const session: ConversationSession = {
    conversationId: "c1",
    whatsappUserId: "49123",
    entries: [
      {
        role: "user",
        content: "Ich moechte heute Abend Tortellini a la panna essen - gibst du mir die Zutaten, bitte",
        createdAt: new Date(0).toISOString(),
      },
    ],
    metadata: {},
  }

  const result = await runtime.runTurn({
    linkedSubject: { protocolSubjectHeader: "app_user:1" },
    session,
    tools: [],
  })

  assert.equal(result.toolCalls?.[0]?.name, "catalog.meal_candidates")
  assert.equal(result.toolCalls?.[0]?.input?.query, "Tortellini a la panna")
})

test("runtime composes a grounded starter basket from meal candidates", async () => {
  const planner: ShoppingPlanner = {
    async plan() {
      return {
        action: "recipe",
        confidence: 0.95,
        query: "Gemuese mit Fisch",
      }
    },
    async composeMeal() {
      return {
        title: "Gemuese mit Fisch",
        intro: "Ich wuerde fuer heute mit Fisch, Gemuese und einer einfachen Beilage starten.",
        selectedProductIds: [101, 201, 301],
        followUpQuestion: "Magst du dazu lieber Kartoffeln oder Reis?",
        unresolvedIngredients: ["beilage"],
      }
    },
  }
  const runtime = new SimpleCheckoutAgentRuntime({ planner })
  const session: ConversationSession = {
    conversationId: "c1",
    whatsappUserId: "49123",
    entries: [
      {
        role: "user",
        content: "Gemuese mit Fisch",
        createdAt: new Date(0).toISOString(),
      },
      {
        role: "tool",
        name: "catalog.meal_candidates",
        content: JSON.stringify({
          mealTitle: "Gemuese mit Fisch",
          ingredientQueries: ["fisch", "gemuese", "kartoffel"],
          groups: [
            {
              ingredient: "fisch",
              options: [
                { productId: 101, label: "Lachsfilet", value: "Lachsfilet" },
                { productId: 102, label: "Kabeljaufilet", value: "Kabeljaufilet" },
              ],
            },
            {
              ingredient: "gemuese",
              options: [
                { productId: 201, label: "Brokkoli", value: "Brokkoli" },
                { productId: 202, label: "Zucchini", value: "Zucchini" },
              ],
            },
            {
              ingredient: "kartoffel",
              options: [
                { productId: 301, label: "Kartoffeln festkochend", value: "Kartoffeln festkochend" },
              ],
            },
          ],
          unresolvedIngredients: [],
        }),
        createdAt: new Date(0).toISOString(),
      },
    ],
    metadata: {},
  }

  const result = await runtime.runTurn({
    linkedSubject: { protocolSubjectHeader: "app_user:1" },
    session,
    tools: [],
  })

  assert.match(String(result.reply || ""), /Fisch, Gemuese und einer einfachen Beilage/i)
  assert.match(String(result.reply || ""), /1\. Lachsfilet/)
  assert.match(String(result.reply || ""), /2\. Brokkoli/)
  assert.match(String(result.reply || ""), /3\. Kartoffeln festkochend/)
  assert.match(String(result.reply || ""), /Kartoffeln oder Reis/i)
  assert.deepEqual(result.metadata?.pendingBundleProductIds, [101, 201, 301])
})

test("runtime treats 'Ja, bitte' as accepting the proposed bundle", async () => {
  const runtime = new SimpleCheckoutAgentRuntime()
  const session: ConversationSession = {
    conversationId: "c1",
    whatsappUserId: "49123",
    entries: [
      {
        role: "user",
        content: "Ja, bitte",
        createdAt: new Date(0).toISOString(),
      },
    ],
    metadata: {
      pendingBundleProductIds: [101, 201, 301],
      pendingRecipeTitle: "Tortellini a la Panna",
    },
  }

  const result = await runtime.runTurn({
    linkedSubject: { protocolSubjectHeader: "app_user:1" },
    session,
    tools: [],
  })

  assert.equal(result.toolCalls?.[0]?.name, "cart.add_bundle")
  assert.deepEqual(result.toolCalls?.[0]?.input?.productIds, [101, 201, 301])
})
