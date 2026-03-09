import test from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, readFile, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { FileStateStore } from "./stateStore.js"

test("sqlite state store persists conversation, channel link, and marketplace order link", async () => {
  const dir = await mkdtemp(join(tmpdir(), "wa-state-"))
  const store = new FileStateStore(join(dir, "state.sqlite"))

  await store.upsert("user:whatsapp_49123", {
    orderId: "ord_1",
    lastRecipe: { title: "Paella" },
    lastCart: { items: [{ sku: "rice", name: "Rice", qty: 1 }], total_cents: 1234, currency: "EUR" },
  })

  await store.upsertChannelLink("whatsapp:+49123", {
    channel_app_id: "whatsapp_main",
    status: "linked",
    valuya_protocol_subject_header: "user:17",
  })
  await store.upsertProfile("user:whatsapp_49123", {
    onboardingStage: "address_captured",
    profile: {
      deliveryAddressHint: "Kaiserstrasse 8/7a, 1070 Wien",
      guidedMode: true,
      shoppingPreferences: { bio: true, regional: true },
      pendingDialog: {
        kind: "modify_or_new",
        options: ["modify_current_cart", "start_new_cart"],
        proposedMessage: "Getraenke fuer party",
      },
    },
  })

  await store.upsertMarketplaceOrderLink("ord_1", {
    valuya_order_id: "ord_srv_1",
    checkout_url: "https://checkout.example/1",
    protocol_subject_header: "user:17",
    amount_cents: 1234,
    currency: "EUR",
    status: "awaiting_checkout",
  })
  await store.upsertAlfiesProducts([
    {
      product_id: 101,
      slug: "bio-spaghetti",
      title: "Bio Spaghetti",
      price_cents: 299,
      currency: "EUR",
      keywords: ["pasta", "spaghetti"],
      category: "pasta",
    },
  ])

  const conversation = await store.get("user:whatsapp_49123")
  const channelLink = await store.getChannelLink("whatsapp:+49123")
  const profile = await store.getProfile("user:whatsapp_49123")
  const marketplace = await store.getMarketplaceOrderLink("ord_1")
  const alfiesProducts = await store.listAlfiesProducts()

  assert.equal(conversation?.orderId, "ord_1")
  assert.equal(conversation?.lastRecipe?.title, "Paella")
  assert.equal(channelLink?.valuya_protocol_subject_header, "user:17")
  assert.equal(profile?.onboardingStage, "address_captured")
  assert.equal(profile?.profile?.deliveryAddressHint, "Kaiserstrasse 8/7a, 1070 Wien")
  assert.equal(profile?.profile?.shoppingPreferences?.bio, true)
  assert.equal(profile?.profile?.pendingDialog?.kind, "modify_or_new")
  assert.equal(marketplace?.valuya_order_id, "ord_srv_1")
  assert.equal(marketplace?.status, "awaiting_checkout")
  assert.equal(alfiesProducts.length, 1)
  assert.equal(alfiesProducts[0]?.product_id, 101)
  assert.equal(alfiesProducts[0]?.keywords[0], "pasta")
})

test("legacy json state is migrated automatically when file path still ends with .json", async () => {
  const dir = await mkdtemp(join(tmpdir(), "wa-state-"))
  const legacyPath = join(dir, "state.json")
  await writeFile(
    legacyPath,
    JSON.stringify({
      conversations: {
        "user:whatsapp_49123": {
          subjectId: "user:whatsapp_49123",
          orderId: "ord_legacy",
          lastRecipe: { title: "Legacy Pasta" },
          lastCart: { total_cents: 999, currency: "EUR" },
          updatedAt: "2026-03-09T00:00:00.000Z",
        },
      },
    }),
    "utf8",
  )

  const store = new FileStateStore(legacyPath)
  const conversation = await store.get("user:whatsapp_49123")

  assert.equal(conversation?.orderId, "ord_legacy")
  assert.equal(conversation?.lastRecipe?.title, "Legacy Pasta")

  const backup = await readFile(`${legacyPath}.legacy.json`, "utf8")
  assert.match(backup, /ord_legacy/)
})
