import test from "node:test"
import assert from "node:assert/strict"
import { buildSessionAddress, parseAddressHint, summarizeShippingMethods } from "./alfiesAddress.js"

test("parses address hint into Alfies session fields", () => {
  const parsed = parseAddressHint("Kaiserstrasse 8/7a, 1070 Wien")
  assert.deepEqual(parsed, {
    line1: "Kaiserstrasse",
    house: "8/7a",
    postcode: "1070",
    city: "Wien",
  })
})

test("builds full session address with configured coordinates", () => {
  const address = buildSessionAddress({
    addressHint: "Kaiserstrasse 8/7a, 1070 Wien",
    latitude: 48.201,
    longitude: 16.351,
    shippingMethod: "standard",
  })
  assert.equal(address?.latitude, 48.201)
  assert.equal(address?.shippingMethod, "standard")
})

test("summarizes shipping methods", () => {
  const summary = summarizeShippingMethods({
    standard: { name: "Standard", date: "2026-03-10" },
    express: { name: "Express", date: "2026-03-09" },
  })
  assert.match(String(summary), /Standard/)
  assert.match(String(summary), /Express/)
})
