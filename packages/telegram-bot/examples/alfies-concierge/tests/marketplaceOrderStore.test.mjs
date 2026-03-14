import test from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { MarketplaceOrderStore } from "../dist/telegram-bot/examples/alfies-concierge/marketplaceOrderStore.js"

test("marketplace order store preserves existing checkout data and returns latest order by subject", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "alfies-marketplace-store-"))
  t.after(async () => {
    await rm(dir, { recursive: true, force: true })
  })
  const file = join(dir, "orders.json")
  const store = new MarketplaceOrderStore(file)

  await store.upsert("local-1", {
    valuya_order_id: "ord_1",
    checkout_url: "https://pay.example/one",
    protocol_subject_header: "user:17",
    amount_cents: 199,
    currency: "EUR",
    status: "awaiting_checkout",
  })

  await store.upsert("local-1", {
    valuya_order_id: "ord_1",
    protocol_subject_header: "user:17",
    amount_cents: 199,
    currency: "EUR",
    status: "paid_confirmed",
    external_order_id: "ext_1",
  })

  await store.upsert("local-2", {
    valuya_order_id: "ord_2",
    protocol_subject_header: "user:17",
    amount_cents: 299,
    currency: "EUR",
    status: "awaiting_checkout",
  })

  const first = await store.get("local-1")
  assert.equal(first?.checkout_url, "https://pay.example/one")
  assert.equal(first?.external_order_id, "ext_1")

  const latest = await store.getLatestByProtocolSubject("user:17")
  assert.equal(latest?.local_order_id, "local-2")
})
