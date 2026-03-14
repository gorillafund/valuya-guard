import { FileStateStore } from "../../../whatsapp-bot/dist/whatsapp-bot/src/stateStore.js"
import { CatalogService } from "../../../whatsapp-bot/dist/whatsapp-bot/src/catalogService.js"
import { resolveRecipeRequest } from "../../../whatsapp-bot/dist/whatsapp-bot/src/recipeService.js"
import type { CatalogBrowseOption, CatalogPort, MealCandidateSuggestion, ResolvedCatalogProduct } from "../ports/CatalogPort.js"

export class SharedStateCatalogPortAdapter implements CatalogPort {
  private readonly service: CatalogService

  constructor(stateFile: string) {
    const store = new FileStateStore(stateFile)
    this.service = new CatalogService(store)
  }

  async resolveProductQuery(args: { query: string }) {
    const result = await this.service.resolveDirectProductQuery(args.query)
    if (result.kind === "resolved") {
      return {
        kind: "resolved" as const,
        product: toResolvedProduct(result.option),
      }
    }
    if (result.kind === "product_browse" || result.kind === "category_browse") {
      return {
        kind: "ambiguous" as const,
        options: result.options.slice(0, 4).map(toResolvedProduct),
      }
    }
    return { kind: "no_match" as const }
  }

  async browseCategories(args: { query?: string; page?: number; limit?: number }) {
    const limit = args.limit || 6
    const result = await this.service.browseCategories({
      query: args.query,
      page: args.page,
      limit,
    })
    if ((!result.options || !result.options.length) && args.query) {
      const expanded = await this.expandFamilyCategoryBrowse({
        query: args.query,
        page: args.page || 0,
        limit,
      })
      if (expanded) return expanded
    }
    return {
      prompt: result.prompt,
      options: result.options.map(toBrowseOption),
      hasMore: result.hasMore,
    }
  }

  async browseProducts(args: { query?: string; category?: string; page?: number; limit?: number }) {
    const limit = args.limit || 6
    const result = await this.service.browseProducts({
      query: args.query,
      category: args.category,
      page: args.page,
      limit,
    })
    const options = dedupeBrowseOptions(result.options.map(toBrowseOption))
    if (!options.length && args.query && !args.category) {
      const expanded = await this.expandFamilyProductBrowse({
        query: args.query,
        page: args.page || 0,
        limit,
      })
      if (expanded) return expanded
    }
    return {
      prompt: result.prompt,
      options,
      hasMore: result.hasMore,
    }
  }

  async recipeToProducts(args: { query: string }) {
    const result = await this.service.recipeToProducts({
      query: args.query,
    })
    if (!result || !result.options.length) {
      const fallback = await this.buildRecipeFallback(args.query)
      if (fallback) return fallback
    }
    if (!result) return null
    return {
      recipeTitle: result.recipeTitle,
      options: dedupeBrowseOptions(result.options.map(toBrowseOption)),
      unresolvedIngredients: result.unresolvedIngredients,
    }
  }

  async buildMealCandidates(args: { query: string }): Promise<MealCandidateSuggestion | null> {
    const recipe = resolveRecipeRequest(args.query) || buildIngredientRecipe(args.query)
    if (!recipe) return null

    const ingredientQueries = recipe.ingredients.slice(0, 5)
    const groups: MealCandidateSuggestion["groups"] = []

    for (const ingredient of ingredientQueries) {
      const queries = expandIngredientQueries(ingredient)
      const merged: CatalogBrowseOption[] = []
      for (const query of queries) {
        const result = await this.service.browseProducts({
          query,
          limit: 6,
        })
        merged.push(...result.options.map(toBrowseOption))
      }
      const options = dedupeBrowseOptions(rankIngredientOptions(ingredient, merged)).slice(0, 6)
      if (options.length) {
        groups.push({
          ingredient,
          options,
        })
      }
    }

    const unresolvedIngredients = ingredientQueries.filter((ingredient) =>
      !groups.some((group) => group.ingredient === ingredient),
    )

    return {
      mealTitle: recipe.title,
      ingredientQueries,
      groups,
      unresolvedIngredients,
    }
  }

  private async buildRecipeFallback(query: string) {
    const recipe = resolveRecipeRequest(query) || buildIngredientRecipe(query)
    if (!recipe) return null

    const collected: CatalogBrowseOption[] = []
    const seenProductIds = new Set<number>()

    for (const ingredient of recipe.ingredients.slice(0, 5)) {
      const result = await this.service.browseProducts({
        query: ingredient,
        limit: 3,
      })
      const option = result.options.find((entry) => typeof entry.productId === "number" && !seenProductIds.has(entry.productId))
      if (!option?.productId) continue
      seenProductIds.add(option.productId)
      collected.push(toBrowseOption(option))
      if (collected.length >= 4) break
    }

    if (!collected.length) {
      return {
        recipeTitle: recipe.title,
        options: [],
        unresolvedIngredients: recipe.ingredients,
      }
    }

    const matchedTitles = new Set(collected.map((option) => normalize(option.label)))
    const unresolvedIngredients = recipe.ingredients.filter((ingredient) => {
      const normalized = normalize(ingredient)
      return ![...matchedTitles].some((title) => title.includes(normalized) || normalized.includes(title))
    })

    return {
      recipeTitle: recipe.title,
      options: collected,
      unresolvedIngredients,
    }
  }

  private async expandFamilyCategoryBrowse(args: {
    query: string
    page: number
    limit: number
  }) {
    const expansions = expandFamilyBrowseQueries(args.query)
    if (!expansions.length) return null
    const fetchLimit = Math.max(args.limit * (args.page + 1), args.limit)
    const merged: CatalogBrowseOption[] = []
    for (const query of expansions) {
      const result = await this.service.browseCategories({
        query,
        page: 0,
        limit: fetchLimit,
      })
      merged.push(...result.options.map(toBrowseOption))
    }
    const deduped = dedupeBrowseOptions(merged)
    const start = args.page * args.limit
    const pageOptions = deduped.slice(start, start + args.limit)
    if (!pageOptions.length) return null
    return {
      prompt: `Welche Kategorie moechtest du aus '${args.query}' durchsuchen?`,
      options: pageOptions,
      hasMore: deduped.length > start + pageOptions.length,
    }
  }

  private async expandFamilyProductBrowse(args: {
    query: string
    page: number
    limit: number
  }) {
    const expansions = expandFamilyBrowseQueries(args.query)
    if (!expansions.length) return null
    const fetchLimit = Math.max(args.limit * (args.page + 1), args.limit)
    const merged: CatalogBrowseOption[] = []
    for (const query of expansions) {
      const result = await this.service.browseProducts({
        query,
        page: 0,
        limit: fetchLimit,
      })
      merged.push(...result.options.map(toBrowseOption))
    }
    const deduped = dedupeBrowseOptions(merged)
    const start = args.page * args.limit
    const pageOptions = deduped.slice(start, start + args.limit)
    if (!pageOptions.length) return null
    return {
      prompt: `Welche Produkte passen am besten zu '${normalize(args.query)}'?`,
      options: pageOptions,
      hasMore: deduped.length > start + pageOptions.length,
    }
  }
}

function buildIngredientRecipe(query: string): { title: string; ingredients: string[] } | null {
  const normalized = normalize(query)
  if (!normalized) return null
  const inferredNamedMeal = inferNamedMealRecipe(normalized)
  if (inferredNamedMeal) return inferredNamedMeal
  const cleaned = normalized
    .replace(/\b(ich moechte|ich möchte|ich will|ich brauche|kochen|fuer|für|personen?|kinder|schnell(?:es|e|er)?|gericht)\b/g, " ")
    .replace(/\b\d+\b/g, " ")
    .replace(/\s+/g, " ")
    .trim()
  const ingredients = cleaned
    .split(/\b(?:mit|und|oder)\b/)
    .map((part) => part.trim())
    .filter((part) => part.length >= 3)
    .map((part) => singularizeIngredient(part))
    .filter((part, index, list) => list.indexOf(part) === index)
    .slice(0, 5)

  if (!ingredients.length) return null

  return {
    title: titleCase(ingredients.join(" mit ")),
    ingredients,
  }
}

function inferNamedMealRecipe(normalized: string): { title: string; ingredients: string[] } | null {
  if (/\btortellini\b/.test(normalized) && /\bpanna\b/.test(normalized)) {
    return {
      title: "Tortellini a la Panna",
      ingredients: ["tortellini", "sahne", "schinken", "parmesan"],
    }
  }
  if (/\bvegetarische?\s+pasta\b/.test(normalized)) {
    return {
      title: "Vegetarische Pasta",
      ingredients: ["pasta", "tomaten", "zucchini", "parmesan"],
    }
  }
  if (/\bpasta\b/.test(normalized) && /\btomaten?\b/.test(normalized)) {
    return {
      title: "Pasta mit Tomaten",
      ingredients: ["pasta", "tomaten", "parmesan"],
    }
  }
  return null
}

function toResolvedProduct(option: {
  productId?: number
  sku?: string
  label: string
  unitPriceCents?: number
  currency?: string
}): ResolvedCatalogProduct {
  return {
    productId: Math.trunc(Number(option.productId || 0)),
    sku: option.sku,
    title: option.label,
    unitPriceCents: option.unitPriceCents,
    currency: option.currency,
  }
}

function toBrowseOption(option: {
  id: string
  label: string
  value: string
  productId?: number
  sku?: string
  unitPriceCents?: number
  currency?: string
}): CatalogBrowseOption {
  return {
    id: option.id,
    label: option.label,
    value: option.value,
    productId: option.productId,
    sku: option.sku,
    unitPriceCents: option.unitPriceCents,
    currency: option.currency,
  }
}

function normalize(value: string): string {
  return String(value || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\w\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

function dedupeBrowseOptions(options: CatalogBrowseOption[]): CatalogBrowseOption[] {
  const seen = new Set<string>()
  const deduped: CatalogBrowseOption[] = []
  for (const option of options) {
    const key = option.productId
      ? `product:${option.productId}`
      : `label:${normalize(option.label || option.value)}`
    if (seen.has(key)) continue
    seen.add(key)
    deduped.push(option)
  }
  return deduped
}

function singularizeIngredient(value: string): string {
  return value
    .replace(/\bkartoffeln\b/g, "kartoffel")
    .replace(/\bgemuese\b/g, "gemuese")
    .replace(/\bfische\b/g, "fisch")
    .trim()
}

function titleCase(value: string): string {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ")
}

function expandIngredientQueries(ingredient: string): string[] {
  const normalized = normalize(ingredient)
  const queries = [normalized]
  if (normalized === "fisch") queries.push("lachs", "kabeljau", "forelle")
  if (normalized === "gemuese") queries.push("brokkoli", "zucchini", "paprika", "karotte")
  if (normalized === "kartoffel") queries.push("kartoffeln")
  if (normalized === "reis") queries.push("reis", "basmati")
  return queries.filter((value, index, list) => value && list.indexOf(value) === index)
}

function rankIngredientOptions(ingredient: string, options: CatalogBrowseOption[]): CatalogBrowseOption[] {
  const ingredientTokens = tokenize(normalize(ingredient))
  return [...options].sort((left, right) => {
    const scoreRight = scoreIngredientOption(right, ingredientTokens)
    const scoreLeft = scoreIngredientOption(left, ingredientTokens)
    if (scoreRight !== scoreLeft) return scoreRight - scoreLeft
    return normalize(left.label).localeCompare(normalize(right.label))
  })
}

function scoreIngredientOption(option: CatalogBrowseOption, ingredientTokens: string[]): number {
  const label = normalize(option.label || option.value || "")
  const labelTokens = tokenize(label)
  let score = 0
  for (const token of ingredientTokens) {
    if (label.includes(token)) score += 4
    if (labelTokens.includes(token)) score += 2
  }
  if (ingredientTokens.includes("fisch") && /\b(lachs|forelle|kabeljau|fisch|saibling|thunfisch)\b/.test(label)) score += 8
  if (ingredientTokens.includes("gemuese") && /\b(gemuese|brokkoli|zucchini|karotte|paprika|spinat|salat)\b/.test(label)) score += 8
  if (ingredientTokens.includes("kartoffel") && /\bkartoffel/.test(label)) score += 8
  return score
}

function tokenize(value: string): string[] {
  return value.split(/\s+/).filter(Boolean)
}

function expandFamilyBrowseQueries(query: string): string[] {
  const normalized = normalize(query)
  const families: Record<string, string[]> = {
    getraenke: ["bier", "softdrinks", "wasser", "saft", "wein", "eistee", "mate", "energydrink"],
    snacks: ["chips", "schokolade", "kekse", "popcorn", "nuesse"],
    baby: ["baby", "babynahrung", "windeln"],
    babyprodukte: ["baby", "babynahrung", "windeln"],
    haushalt: ["putzmittel", "waschmittel", "wc papier", "spuelmittel", "kuechenrolle"],
    putzmittel: ["putzmittel", "spuelmittel", "waschmittel"],
    suessigkeiten: ["schokolade", "kekse", "fruchtgummi", "bonbons"],
    pizza: ["pizza", "tiefkuehlpizza"],
  }
  const expansions = families[normalized]
  return expansions ? expansions.filter((value, index, list) => value && list.indexOf(value) === index) : []
}
