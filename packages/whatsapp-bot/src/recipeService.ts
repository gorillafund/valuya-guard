export type ResolvedRecipeRequest = {
  title: string
  normalizedDish: string
  servings?: number
  ingredients: string[]
  requiredAnchors: string[]
}

type RecipeSeed = {
  title: string
  aliases: string[]
  ingredients: string[]
  requiredAnchors?: string[]
}

const RECIPE_SEEDS: RecipeSeed[] = [
  {
    title: "Moussaka",
    aliases: ["moussaka", "musaka", "musakka"],
    ingredients: ["aubergine", "kartoffeln", "faschiertes", "tomaten", "zwiebel", "knoblauch", "oregano", "feta"],
    requiredAnchors: ["aubergine", "faschiertes", "feta"],
  },
  {
    title: "Tacos",
    aliases: ["tacos", "taco"],
    ingredients: ["tortillas", "faschiertes", "salat", "tomaten", "zwiebel", "mais", "salsa", "kaese"],
    requiredAnchors: ["tortillas", "salsa", "kaese"],
  },
  {
    title: "Lasagne",
    aliases: ["lasagne", "lasagna"],
    ingredients: ["lasagneblaetter", "faschiertes", "tomaten", "zwiebel", "mozzarella", "parmesan"],
    requiredAnchors: ["lasagneblaetter", "tomaten", "mozzarella"],
  },
  {
    title: "Paella",
    aliases: ["paella"],
    ingredients: ["reis", "paprika", "erbsen", "zwiebel", "knoblauch", "safran", "fond"],
    requiredAnchors: ["reis", "safran", "fond"],
  },
]

export function looksLikeRecipeRequest(message: string): boolean {
  const normalized = normalize(message)
  if (!normalized) return false
  if (/\b(rezept|rezeptvorschlag|gericht|kochen|machen|ausprobieren|zutaten)\b/.test(normalized)) {
    return true
  }
  return RECIPE_SEEDS.some((seed) => seed.aliases.some((alias) => normalized.includes(alias)))
}

export function resolveRecipeRequest(message: string): ResolvedRecipeRequest | null {
  const normalized = normalize(message)
  if (!normalized) return null
  const seed = RECIPE_SEEDS.find((entry) => entry.aliases.some((alias) => normalized.includes(alias)))
  if (!seed) return null

  return {
    title: seed.title,
    normalizedDish: seed.aliases[0] || seed.title.toLowerCase(),
    servings: extractServings(normalized),
    ingredients: seed.ingredients,
    requiredAnchors: seed.requiredAnchors || seed.ingredients.slice(0, 3),
  }
}

function extractServings(text: string): number | undefined {
  const match =
    /\bfor\s+(\d{1,2})\b/.exec(text) ||
    /\bfuer\s+(\d{1,2})\b/.exec(text) ||
    /\bfur\s+(\d{1,2})\b/.exec(text) ||
    /\bmit\s+(\d{1,2})\s+personen\b/.exec(text)
  if (!match?.[1]) return undefined
  const parsed = Math.trunc(Number(match[1]))
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined
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
