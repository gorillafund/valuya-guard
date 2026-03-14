import type {
  ConversationProfile,
  ConversationReferenceItem,
  FileStateStore,
  PendingOption,
  ShoppingPreferences,
  StoredAlfiesProduct,
} from "./stateStore.js"
import {
  buildCategorySelectionOptions,
  buildMatchingCategoryOptions,
  buildProductsForCategoryOptions,
  buildProductSelectionOptions,
} from "./optionSelectionService.js"
import { resolveProductsFromCatalog } from "./alfiesProductResolver.js"
import { resolveRecipeRequest } from "./recipeService.js"

export type CatalogOptionSet = {
  prompt: string
  options: PendingOption[]
  hasMore: boolean
  sourceQuery?: string
  sourceCategory?: string
}

export type RecipeProductSet = {
  recipeTitle: string
  options: PendingOption[]
  unresolvedIngredients: string[]
}

export type DirectProductResolution =
  | {
      kind: "resolved"
      option: PendingOption
    }
  | {
      kind: "category_browse"
      prompt: string
      options: PendingOption[]
    }
  | {
      kind: "product_browse"
      prompt: string
      options: PendingOption[]
    }
  | {
      kind: "no_match"
    }

export class CatalogService {
  private readonly store: FileStateStore

  constructor(store: FileStateStore) {
    this.store = store
  }

  async browseCategories(args: {
    query?: string
    page?: number
    limit?: number
  }): Promise<CatalogOptionSet> {
    const products = await this.store.listAlfiesProducts()
    const limit = args.limit || 6
    const offset = Math.max(0, (args.page || 0) * limit)
    const query = String(args.query || "").trim()
    const options = query
      ? buildMatchingCategoryOptions({
          query,
          products,
          limit,
          offset,
        })
      : buildCategorySelectionOptions(products, limit, offset)
    const nextSlice = query
      ? buildMatchingCategoryOptions({
          query,
          products,
          limit,
          offset: offset + limit,
        })
      : buildCategorySelectionOptions(products, limit, offset + limit)
    return {
      prompt: query
        ? `Welche Kategorie passt am besten zu '${query}'?`
        : "Welche Kategorie moechtest du durchsuchen?",
      options,
      hasMore: nextSlice.length > 0,
      sourceQuery: query || undefined,
    }
  }

  async browseProducts(args: {
    query?: string
    category?: string
    page?: number
    limit?: number
  }): Promise<CatalogOptionSet> {
    const products = await this.store.listAlfiesProducts()
    const limit = args.limit || 8
    const offset = Math.max(0, (args.page || 0) * limit)
    const category = String(args.category || "").trim()
    const query = String(args.query || "").trim()
    const options = category
      ? buildProductsForCategoryOptions({
          category,
          products,
          limit,
          offset,
        })
      : buildProductSelectionOptions({
          query,
          products,
          limit,
          offset,
        })
    const nextSlice = category
      ? buildProductsForCategoryOptions({
          category,
          products,
          limit,
          offset: offset + limit,
        })
      : buildProductSelectionOptions({
          query,
          products,
          limit,
          offset: offset + limit,
        })
    return {
      prompt: category
        ? `Was moechtest du aus ${category}?`
        : `Welche Produkte passen am besten zu '${query}'?`,
      options,
      hasMore: nextSlice.length > 0,
      sourceQuery: query || undefined,
      sourceCategory: category || undefined,
    }
  }

  async recipeToProducts(args: {
    query: string
    preferences?: ShoppingPreferences
  }): Promise<RecipeProductSet | null> {
    const recipe = resolveRecipeRequest(args.query)
    if (!recipe) return null

    const products = await this.store.listAlfiesProducts()
    const resolved = resolveProductsFromCatalog(
      args.query,
      products,
      args.preferences,
      undefined,
      recipe,
    )
    if (!resolved?.lines.length) {
      return {
        recipeTitle: recipe.title,
        options: [],
        unresolvedIngredients: recipe.ingredients,
      }
    }

    const options: PendingOption[] = []
    for (const [index, line] of resolved.lines.entries()) {
      const product = products.find((entry) => entry.product_id === line.id)
      if (!product) continue
      options.push({
        id: `recipe_product_${index + 1}`,
        label: product.title,
        value: product.title,
        productId: product.product_id,
        sku: product.slug,
        unitPriceCents: product.price_cents,
        currency: product.currency,
      })
    }

    const matchedTitles = new Set(options.map((option) => normalize(option.label)))
    const unresolvedIngredients = recipe.ingredients.filter((ingredient) => {
      const normalized = normalize(ingredient)
      return ![...matchedTitles].some((title) => title.includes(normalized) || normalized.includes(title))
    })

    return {
      recipeTitle: recipe.title,
      options,
      unresolvedIngredients,
    }
  }

  async showProductDetails(productId: number): Promise<StoredAlfiesProduct | null> {
    const products = await this.store.listAlfiesProducts()
    return products.find((product) => product.product_id === productId) || null
  }

  async resolveDirectProductQuery(query: string): Promise<DirectProductResolution> {
    const products = await this.store.listAlfiesProducts()
    const normalizedQuery = normalize(query)
    const categoryOptions = buildMatchingCategoryOptions({
      query,
      products,
      limit: 6,
      offset: 0,
    })
    if (looksBroadFamilyQuery(normalizedQuery) && categoryOptions.length > 0) {
      return {
        kind: "category_browse",
        prompt: `Welche Kategorie passt am besten zu '${query}'?`,
        options: categoryOptions,
      }
    }

    const exact = products.find((product) =>
      normalize(product.title) === normalizedQuery ||
      normalize(product.slug || "") === normalizedQuery,
    )
    if (exact) {
      return {
        kind: "resolved",
        option: toPendingOption(exact, 1),
      }
    }

    const scored = products
      .map((product) => ({
        product,
        score: overlapScore(normalizedQuery, normalize([product.title, product.category, ...product.keywords].join(" "))),
      }))
      .filter((entry) => entry.score > 0)
      .sort((a, b) =>
        b.score - a.score ||
        (a.product.price_cents || Number.MAX_SAFE_INTEGER) - (b.product.price_cents || Number.MAX_SAFE_INTEGER) ||
        a.product.title.localeCompare(b.product.title),
      )

    if (!scored.length) {
      return categoryOptions.length > 0
        ? {
            kind: "category_browse",
            prompt: `Welche Kategorie passt am besten zu '${query}'?`,
            options: categoryOptions,
          }
        : { kind: "no_match" }
    }

    const [top, second] = scored
    if (top && top.score >= 2 && (!second || top.score >= second.score + 2)) {
      return {
        kind: "resolved",
        option: toPendingOption(top.product, 1),
      }
    }

    const productOptions = scored.slice(0, 6).map((entry, index) => toPendingOption(entry.product, index + 1))
    return {
      kind: "product_browse",
      prompt: `Welche Variante von '${query}' meinst du?`,
      options: productOptions,
    }
  }

  buildShownReferences(options: PendingOption[]): ConversationReferenceItem[] {
    return options
      .filter((option) => option.productId || option.sku)
      .map((option) => ({
        productId: option.productId,
        sku: option.sku,
        title: option.label,
      }))
  }
}

function toPendingOption(product: StoredAlfiesProduct, index: number): PendingOption {
  return {
    id: `product_${index}`,
    label: product.title,
    value: product.title,
    productId: product.product_id,
    sku: product.slug,
    unitPriceCents: product.price_cents,
    currency: product.currency,
  }
}

function overlapScore(left: string, right: string): number {
  const leftTokens = new Set(left.split(" ").filter(Boolean))
  const rightTokens = new Set(right.split(" ").filter(Boolean))
  let score = 0
  for (const token of leftTokens) {
    if (rightTokens.has(token)) score += 1
  }
  return score
}

function looksBroadFamilyQuery(query: string): boolean {
  if (!query) return false
  return /\b(kaese|fleisch|getranke|getraenke|bier|brot|milch|milchprodukte|putzmittel|klopapier|zahnpasta|baby|haustier|pasta|reis|gemuse|gemuese)\b/.test(query)
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
