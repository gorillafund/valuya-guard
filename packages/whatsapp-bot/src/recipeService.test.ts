import test from "node:test"
import assert from "node:assert/strict"
import { looksLikeRecipeRequest, resolveRecipeRequest } from "./recipeService.js"

test("detects recipe-like dish requests", () => {
  assert.equal(looksLikeRecipeRequest("Ich moechte ein Rezeptvorschlag haen"), true)
  assert.equal(looksLikeRecipeRequest("Ich moechte Musaka ausprobieren"), true)
  assert.equal(looksLikeRecipeRequest("Milch"), false)
})

test("resolves moussaka aliases into normalized recipe ingredients", () => {
  const resolved = resolveRecipeRequest("Ich moechte Musaka ausprobieren")
  assert.equal(resolved?.title, "Moussaka")
  assert.ok(resolved?.ingredients.includes("aubergine"))
  assert.ok(resolved?.ingredients.includes("faschiertes"))
})

test("extracts servings from recipe request when present", () => {
  const resolved = resolveRecipeRequest("Moussaka fuer 4")
  assert.equal(resolved?.servings, 4)
})
