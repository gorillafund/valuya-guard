export type ResolvedCatalogProduct = {
  productId: number
  sku?: string
  title: string
  unitPriceCents?: number
  currency?: string
}

export type CatalogBrowseOption = {
  id: string
  label: string
  value: string
  productId?: number
  sku?: string
  unitPriceCents?: number
  currency?: string
}

export type RecipeSuggestion = {
  recipeTitle: string
  options: CatalogBrowseOption[]
  unresolvedIngredients: string[]
}

export type MealCandidateGroup = {
  ingredient: string
  options: CatalogBrowseOption[]
}

export type MealCandidateSuggestion = {
  mealTitle: string
  ingredientQueries: string[]
  groups: MealCandidateGroup[]
  unresolvedIngredients: string[]
}

export type CatalogPort = {
  resolveProductQuery(args: {
    query: string
  }): Promise<
    | { kind: "resolved"; product: ResolvedCatalogProduct }
    | { kind: "ambiguous"; options: ResolvedCatalogProduct[] }
    | { kind: "no_match" }
  >
  browseCategories(args: {
    query?: string
    page?: number
    limit?: number
  }): Promise<{
    prompt: string
    options: CatalogBrowseOption[]
    hasMore?: boolean
  }>
  browseProducts(args: {
    query?: string
    category?: string
    page?: number
    limit?: number
  }): Promise<{
    prompt: string
    options: CatalogBrowseOption[]
    hasMore?: boolean
  }>
  recipeToProducts(args: {
    query: string
  }): Promise<RecipeSuggestion | null>
  buildMealCandidates(args: {
    query: string
  }): Promise<MealCandidateSuggestion | null>
}
