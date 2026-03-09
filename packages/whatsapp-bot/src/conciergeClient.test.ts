import test from "node:test"
import assert from "node:assert/strict"
import { ConciergeClient } from "./conciergeClient.js"

test("builds a local draft cart from free text", async () => {
  const concierge = new ConciergeClient()

  const response = await concierge.call({
    action: "recipe",
    orderId: "ord_1",
    message: "vegetarian pasta for 3",
    subject: { type: "whatsapp", id: "+49123456789" },
  })

  assert.equal(response.ok, true)
  assert.equal(response.orderId, "ord_1")
  assert.match(String(response.recipe?.title), /Vegetarian Comfort Pasta Dinner/)
  assert.equal(response.cart?.currency, "EUR")
  assert.ok(Array.isArray(response.cart?.items))
  assert.ok((response.cart?.items?.length || 0) >= 4)
  assert.match(String(response.text), /Portionen: 3/)
})

test("returns a modified alternative cart from existing state", async () => {
  const concierge = new ConciergeClient()

  const response = await concierge.call({
    action: "alt",
    orderId: "ord_2",
    cartState: {
      items: [
        { sku: "alfies-pasta-rigatoni-500g", name: "Rigatoni 500g", qty: 1, unit_price_cents: 349 },
      ],
      total_cents: 349,
      currency: "EUR",
    },
    subject: { type: "whatsapp", id: "+49123456789" },
  })

  assert.equal(response.ok, true)
  assert.match(String(response.recipe?.title), /Alternative/)
  assert.ok((response.cart?.items?.length || 0) >= 4)
  assert.match(String(response.text), /Neue Zwischensumme/)
})

test("confirms using the current cart state", async () => {
  const concierge = new ConciergeClient()

  const response = await concierge.call({
    action: "confirm",
    orderId: "ord_3",
    cartState: {
      items: [{ sku: "x", name: "Test Product", qty: 2, unit_price_cents: 250 }],
      total_cents: 500,
      currency: "EUR",
    },
    subject: { type: "whatsapp", id: "+49123456789" },
  })

  assert.equal(response.ok, true)
  assert.equal(response.eta, "35-50 Minuten")
  assert.match(String(response.text), /Gesamtsumme: 5.00 EUR/)
})

test("supports the 1-cent test basket", async () => {
  const concierge = new ConciergeClient()

  const response = await concierge.call({
    action: "test_1cent",
    orderId: "ord_test_1cent",
    subject: { type: "whatsapp", id: "+49123456789" },
  })

  assert.equal(response.ok, true)
  assert.equal(response.orderId, "ord_test_1cent")
  assert.equal(response.recipe?.title, "1-Cent Testbestellung")
  assert.equal(response.cart?.total_cents, 1)
  assert.equal(response.cart?.currency, "EUR")
  assert.deepEqual(response.cart?.items, [
    {
      sku: "ALF-TEST-001",
      name: "Gurke 1kg",
      qty: 1,
      unit_price_cents: 1,
    },
  ])
  assert.match(String(response.text), /1-Cent-Testmodus aktiv/)
})
