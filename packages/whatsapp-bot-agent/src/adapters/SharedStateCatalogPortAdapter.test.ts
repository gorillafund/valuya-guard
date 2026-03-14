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
