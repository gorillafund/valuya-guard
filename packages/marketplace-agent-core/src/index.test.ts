import test from "node:test"
import assert from "node:assert/strict"
import {
  buildCheckoutPreparedReply,
  buildMarketplaceSessionSnapshot,
  buildPaymentConfirmedReply,
  buildPolygonScanTxUrl,
  buildTransactionLines,
  createValuyaMarketplaceHttpClient,
  decideMarketplaceStatus,
  deriveMarketplaceStatusPhase,
  readMarketplaceSessionState,
  readMarketplaceTransaction,
  writeMarketplaceSessionState,
} from "./index.js"

test("reads marketplace transaction from nested payment payload", () => {
  const tx = readMarketplaceTransaction({
    payment: {
      tx_hash: "0xabc",
      chain_id: 80002,
    },
  })

  assert.deepEqual(tx, {
    txHash: "0xabc",
    chainId: 80002,
  })
})

test("builds german paid reply with transaction and external order id", () => {
  const reply = buildPaymentConfirmedReply({
    transaction: { txHash: "0xabc", chainId: 137 },
    submittedToMerchant: true,
    externalOrderId: "ord_123",
    language: "de",
  })

  assert.match(reply, /✓ Bezahlt\./)
  assert.match(reply, /ord_123/)
  assert.match(reply, /polygonscan\.com\/tx\/0xabc/)
})

test("builds amoy polygonscan url for amoy chain", () => {
  assert.equal(
    buildPolygonScanTxUrl("0xabc", 80002),
    "https://amoy.polygonscan.com/tx/0xabc",
  )
})

test("builds transaction lines only when tx hash is present", () => {
  assert.deepEqual(
    buildTransactionLines({
      transaction: { chainId: 137 },
      language: "de",
    }),
    [],
  )
})

test("builds default checkout prepared reply", () => {
  const reply = buildCheckoutPreparedReply({
    amountCents: 199,
    currency: "EUR",
    itemCount: 2,
    checkoutUrl: "https://pay.example/checkout/123",
    language: "de",
  })

  assert.match(reply, /1,99/)
  assert.match(reply, /Warenkorbpositionen: 2/)
  assert.match(reply, /https:\/\/pay\.example\/checkout\/123/)
})

test("shared marketplace client creates marketplace order", async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = []
  const client = createValuyaMarketplaceHttpClient({
    baseUrl: "https://guard.example",
    tenantToken: "ttok_123",
    fetchImpl: async (url, init) => {
      calls.push({ url: String(url), init })
      return new Response(
        JSON.stringify({
          ok: true,
          order: { order_id: "ord_123" },
          checkout_url: "https://pay.example/checkout/ord_123",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      )
    },
  })

  const result = await client.createMarketplaceOrder({
    guardSubject: { id: "42" },
    protocolSubjectHeader: "user:17",
    productId: 99,
    merchantSlug: "alfies",
    channel: "whatsapp",
    resource: "merchant:alfies:channel",
    plan: "standard",
    amountCents: 499,
    currency: "EUR",
    asset: "EURe",
    cart: { items: [] },
    localOrderId: "local_1",
  })

  assert.equal(calls[0]?.url, "https://guard.example/api/marketplace/orders")
  assert.equal(result.order?.order_id, "ord_123")
})

test("derives pending submission phase from paid snapshot with order context", () => {
  const snapshot = buildMarketplaceSessionSnapshot({
    entitlementActive: true,
    marketplaceOrderId: "ord_123",
    submittedToMerchant: false,
    marketplaceOrder: {
      payment: {
        tx_hash: "0xabc",
      },
    },
  })

  assert.equal(deriveMarketplaceStatusPhase(snapshot), "paid_pending_submission")
  assert.equal(snapshot.transaction?.txHash, "0xabc")
})

test("status decision asks to fetch order status when paid order context exists without payload", () => {
  const snapshot = buildMarketplaceSessionSnapshot({
    entitlementActive: true,
    marketplaceOrderId: "ord_123",
    submittedToMerchant: false,
  })

  assert.deepEqual(
    decideMarketplaceStatus({
      snapshot,
      hasMarketplaceOrderStatus: false,
    }),
    {
      kind: "fetch_order_status",
      marketplaceOrderId: "ord_123",
    },
  )
})

test("marketplace session state round-trips through metadata helpers", () => {
  const metadata = writeMarketplaceSessionState({
    metadata: { existing: true },
    session: {
      resource: "merchant:alfies:channel",
      plan: "standard",
      marketplaceOrderId: "ord_123",
      checkoutUrl: "https://pay.example/checkout/123",
      shippingDate: "2026-03-14",
      deliveryAddress: { city: "Wien" },
    },
  })

  const state = readMarketplaceSessionState(metadata)
  assert.equal(state.resource, "merchant:alfies:channel")
  assert.equal(state.marketplaceOrderId, "ord_123")
  assert.equal(state.shippingDate, "2026-03-14")
  assert.equal(state.deliveryAddress?.city, "Wien")
})
