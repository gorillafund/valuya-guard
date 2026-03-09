import test from "node:test"
import assert from "node:assert/strict"
import { AlfiesClient } from "./alfiesClient.js"

test("alfies client persists session cookie and country header", async () => {
  const calls: Array<{ input: string; init?: RequestInit }> = []
  let callIndex = 0
  const fetchImpl: typeof fetch = async (input, init) => {
    calls.push({ input: String(input), init })
    callIndex += 1
    if (callIndex === 1) {
      return new Response(JSON.stringify({ id: 7 }), {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "set-cookie": "sessionid=test-session-1; Path=/; HttpOnly",
        },
      })
    }
    return new Response(JSON.stringify({ status: "ok" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    })
  }

  const client = new AlfiesClient({ fetchImpl })
  await client.getBasket()
  await client.addBasketProduct({ id: 47, quantity: 1 })

  const firstHeaders = new Headers(calls[0]?.init?.headers)
  const secondHeaders = new Headers(calls[1]?.init?.headers)

  assert.equal(firstHeaders.get("x-country-code"), "AT")
  assert.equal(secondHeaders.get("cookie"), "sessionid=test-session-1")
  assert.equal(calls[1]?.input, "https://test-api.alfies.shop/api/v1/basket/products")
})
