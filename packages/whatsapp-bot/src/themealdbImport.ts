import { resolve } from "node:path"
import { FileStateStore } from "./stateStore.js"

const STATE_FILE = process.env.WHATSAPP_STATE_FILE?.trim() || resolve(process.cwd(), ".data/whatsapp-state.sqlite")
const BASE_URL = process.env.THEMEALDB_BASE_URL?.trim() || "https://www.themealdb.com/api/json/v1/1"

type MealDbSearchResponse = {
  meals?: Array<Record<string, unknown>>
}

async function main(): Promise<void> {
  const queries = process.argv.slice(2).map((value: string) => value.trim()).filter(Boolean)
  if (queries.length === 0) {
    throw new Error("usage: pnpm --filter @valuya/whatsapp-bot import:themealdb-recipes musaka moussaka lasagne")
  }

  const store = new FileStateStore(STATE_FILE)
  const imported: Array<{
    recipe_id: string
    slug: string
    title: string
    cuisine?: string
    source?: string
    source_url?: string
    aliases: string[]
    instructions_short?: string[]
    updated_at: string
    ingredients: Array<{
      recipe_id: string
      name: string
      quantity?: string
      unit?: string
      sort_order: number
    }>
  }> = []

  for (const query of queries) {
    const response = await fetch(`${BASE_URL}/search.php?s=${encodeURIComponent(query)}`)
    if (!response.ok) {
      throw new Error(`themealdb_http_${response.status}`)
    }
    const body = (await response.json()) as MealDbSearchResponse
    const meals = Array.isArray(body.meals) ? body.meals : []
    for (const meal of meals) {
      const normalized = normalizeMeal(meal, query)
      if (normalized) imported.push(normalized)
    }
  }

  const deduped = dedupeRecipes(imported)
  await store.upsertRecipes(deduped)
  console.log(JSON.stringify({
    ok: true,
    imported: deduped.length,
    stateFile: STATE_FILE,
    queries,
  }))
}

function normalizeMeal(meal: Record<string, unknown>, alias: string) {
  const recipeId = String(meal.idMeal || "").trim()
  const title = String(meal.strMeal || "").trim()
  if (!recipeId || !title) return null
  const slug = slugify(title)
  const instructions = String(meal.strInstructions || "")
    .split(/\r?\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 8)
  const ingredients = buildIngredients(recipeId, meal)
  return {
    recipe_id: recipeId,
    slug,
    title,
    cuisine: String(meal.strArea || "").trim() || undefined,
    source: "TheMealDB",
    source_url: String(meal.strSource || meal.strYoutube || "").trim() || undefined,
    aliases: [...new Set([slugify(alias), slug])].filter(Boolean),
    instructions_short: instructions,
    updated_at: new Date().toISOString(),
    ingredients,
  }
}

function buildIngredients(recipeId: string, meal: Record<string, unknown>) {
  const ingredients: Array<{
    recipe_id: string
    name: string
    quantity?: string
    unit?: string
    sort_order: number
  }> = []
  for (let i = 1; i <= 20; i += 1) {
    const name = String(meal[`strIngredient${i}`] || "").trim()
    const measure = String(meal[`strMeasure${i}`] || "").trim()
    if (!name) continue
    ingredients.push({
      recipe_id: recipeId,
      name,
      quantity: measure || undefined,
      unit: undefined,
      sort_order: i,
    })
  }
  return ingredients
}

function dedupeRecipes<T extends { recipe_id: string }>(recipes: T[]): T[] {
  const byId = new Map<string, T>()
  for (const recipe of recipes) {
    byId.set(recipe.recipe_id, recipe)
  }
  return [...byId.values()]
}

function slugify(value: string): string {
  return String(value || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\w\s-]/g, " ")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }))
  process.exitCode = 1
})
