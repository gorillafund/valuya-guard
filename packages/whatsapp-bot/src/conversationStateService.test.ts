import test from "node:test"
import assert from "node:assert/strict"
import { mkdtemp } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { FileStateStore } from "./stateStore.js"
import { ConversationStateService } from "./conversationStateService.js"

test("conversation state service persists history, clarification, and shown products", async () => {
  const dir = await mkdtemp(join(tmpdir(), "wa-conv-state-"))
  const store = new FileStateStore(join(dir, "state.sqlite"))
  const service = new ConversationStateService(store)

  await service.recordInboundMessage("user:1", "bier")
  await service.recordUnderstanding("user:1", {
    intent: "search_product",
    entities: { categories: ["beer"] },
    clarification: { kind: "clarify", question: "Meinst du Flaschen oder eine Kiste?" },
  })
  await service.recordShownProducts("user:1", [
    { title: "Beer One", sku: "beer-1" },
    { title: "Beer Two", sku: "beer-2" },
  ])

  const snapshot = await service.getSnapshot("user:1")
  assert.equal(snapshot.profile?.latestMessage, "bier")
  assert.equal(snapshot.profile?.extractedIntent, "search_product")
  assert.equal(snapshot.profile?.pendingClarification?.question, "Meinst du Flaschen oder eine Kiste?")
  assert.equal(snapshot.profile?.interactionState?.phase, "disambiguation")
  assert.equal(snapshot.profile?.lastShownProducts?.[1]?.title, "Beer Two")
  assert.match(service.buildContextSummary(snapshot), /Beer One/)
  assert.match(service.buildContextSummary(snapshot), /phase=disambiguation/)
})

test("conversation state service derives interaction state for pending options and quantity questions", async () => {
  const dir = await mkdtemp(join(tmpdir(), "wa-conv-state-"))
  const store = new FileStateStore(join(dir, "state.sqlite"))
  const service = new ConversationStateService(store)

  await service.setPendingOptions("user:2", {
    kind: "category_selection",
    prompt: "Welche Kategorie meinst du?",
    options: [{ id: "milk", label: "Milch", value: "milch" }],
  })

  let snapshot = await service.getSnapshot("user:2")
  assert.equal(snapshot.profile?.interactionState?.phase, "browsing")
  assert.equal(snapshot.profile?.interactionState?.expected_reply_type, "option_index")

  await service.setActiveProduct("user:2", {
    product: {
      title: "Vollmilch",
      sku: "milk-1",
    },
    question: {
      kind: "quantity_for_product",
      productTitle: "Vollmilch",
    },
    editMode: "add_to_existing_cart",
  })

  snapshot = await service.getSnapshot("user:2")
  assert.equal(snapshot.profile?.interactionState?.last_assistant_act, "asked_quantity")
  assert.equal(snapshot.profile?.interactionState?.expected_reply_type, "quantity")
})
