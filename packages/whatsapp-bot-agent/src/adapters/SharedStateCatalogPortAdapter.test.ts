import test from "node:test"
import assert from "node:assert/strict"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { SharedStateCatalogPortAdapter } from "./SharedStateCatalogPortAdapter.js"

const TEST_DIR = path.dirname(fileURLToPath(import.meta.url))
const STATE_FILE = path.resolve(TEST_DIR, "../../../whatsapp-bot/.data/whatsapp-state.sqlite")

test("adapter expands broad family query 'getraenke' into real Alfies product results", async () => {
  const adapter = new SharedStateCatalogPortAdapter(STATE_FILE)
  const result = await adapter.browseProducts({ query: "getraenke", limit: 20 })

  assert.ok(result.options.length > 0)
  assert.match(result.prompt, /getraenke/i)
})

test("adapter expands broad family query 'getraenke' into real Alfies category results", async () => {
  const adapter = new SharedStateCatalogPortAdapter(STATE_FILE)
  const result = await adapter.browseCategories({ query: "getraenke", limit: 20 })

  assert.ok(result.options.length > 0)
  assert.match(result.prompt, /getraenke/i)
})

test("adapter builds saner grounded meal candidates for paella", async () => {
  const adapter = new SharedStateCatalogPortAdapter(STATE_FILE)
  const result = await adapter.buildMealCandidates({ query: "Paella" })

  assert.ok(result)
  assert.equal(result?.mealTitle, "Paella")
  assert.ok(Array.isArray(result?.groups))
  assert.ok((result?.groups.length || 0) > 0)

  const ingredients = new Set((result?.groups || []).map((group) => group.ingredient))
  assert.ok(ingredients.has("paella reis"))

  const labels = (result?.groups || []).flatMap((group) => group.options.map((option) => option.label))
  assert.ok(labels.length > 0)
  assert.ok(!labels.some((label) => /backerbsen/i.test(label)))
  assert.ok(!labels.some((label) => /bitte zu tisch/i.test(label)))
  assert.ok(!labels.some((label) => /chili con carne/i.test(label)))
})
