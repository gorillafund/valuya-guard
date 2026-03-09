import type { CartState } from "./stateStore.js"
import { fallbackIntent, type ConversationIntent, type OpenAIIntentClient } from "./openaiIntent.js"

export type ConciergeAction = "recipe" | "alt" | "confirm" | "cancel" | "status" | "test_1cent"

export type ConciergeResponse = {
  ok?: boolean
  orderId?: string
  text?: string
  messages?: string[]
  recipe?: { title?: string }
  cart?: { items?: unknown[]; total_cents?: unknown; currency?: unknown }
  eta?: string
  telegram?: {
    text?: string
  }
  [k: string]: unknown
}

export type ConciergeSubject = {
  type: "whatsapp"
  id: string
}

export type ConciergePayload = {
  action: ConciergeAction
  orderId: string
  message?: string
  cartState?: CartState
  subject: ConciergeSubject
}

type ParsedRequest = {
  originalText: string
  normalizedText: string
  servings: number
  dietary: string[]
  category: string
  occasion?: string
}

type CatalogueItem = {
  sku: string
  name: string
  unit_price_cents: number
}

type MenuTemplate = {
  key: string
  triggers: string[]
  title: string
  altTitle: string
  intro: string
  eta: string
  items: CatalogueItem[]
}

type DraftCart = {
  recipe: { title: string }
  cart: { items: CartLine[]; total_cents: number; currency: string }
  eta: string
}

type CartLine = {
  sku: string
  name: string
  qty: number
  unit_price_cents: number
}

const MENU_TEMPLATES: MenuTemplate[] = [
  {
    key: "pasta",
    triggers: ["pasta", "spaghetti", "penne", "lasagne", "lasagna"],
    title: "Comfort Pasta Dinner",
    altTitle: "Fresh Pasta Alternative",
    intro: "Ich habe eine Pasta-Auswahl zusammengestellt.",
    eta: "35-45 Minuten",
    items: [
      { sku: "alfies-pasta-rigatoni-500g", name: "Rigatoni 500g", unit_price_cents: 349 },
      { sku: "alfies-sugo-arrabbiata-400g", name: "Arrabbiata Sauce 400g", unit_price_cents: 429 },
      { sku: "alfies-parmigiano-180g", name: "Parmigiano Reggiano 180g", unit_price_cents: 599 },
      { sku: "alfies-rucola-125g", name: "Rucola 125g", unit_price_cents: 249 },
    ],
  },
  {
    key: "paella",
    triggers: ["paella", "rice", "reis", "seafood"],
    title: "Paella Abend",
    altTitle: "Mediterrane Reis Alternative",
    intro: "Ich habe eine mediterrane Auswahl fuer dich vorbereitet.",
    eta: "40-50 Minuten",
    items: [
      { sku: "alfies-bomba-rice-1kg", name: "Bomba Reis 1kg", unit_price_cents: 649 },
      { sku: "alfies-paella-broth-500ml", name: "Paella Fond 500ml", unit_price_cents: 369 },
      { sku: "alfies-saffron-mix", name: "Safran Gewuerzmix", unit_price_cents: 289 },
      { sku: "alfies-peppers-trio", name: "Paprika Mix", unit_price_cents: 319 },
    ],
  },
  {
    key: "snacks",
    triggers: ["snack", "party", "movie", "chips"],
    title: "Snack Night Bundle",
    altTitle: "Sharing Snacks Alternative",
    intro: "Ich habe dir eine Snack-Auswahl fuer den Abend gebaut.",
    eta: "20-30 Minuten",
    items: [
      { sku: "alfies-potato-chips-salt", name: "Potato Chips Sea Salt", unit_price_cents: 279 },
      { sku: "alfies-mixed-nuts-200g", name: "Mixed Nuts 200g", unit_price_cents: 449 },
      { sku: "alfies-hummus-classic", name: "Hummus Classic", unit_price_cents: 259 },
      { sku: "alfies-crackers-rosemary", name: "Rosemary Crackers", unit_price_cents: 229 },
    ],
  },
  {
    key: "breakfast",
    triggers: ["breakfast", "fruhstuck", "brunch", "morgen"],
    title: "Brunch Starter",
    altTitle: "Easy Breakfast Alternative",
    intro: "Ich habe einen kompakten Brunch-Warenkorb zusammengestellt.",
    eta: "25-35 Minuten",
    items: [
      { sku: "alfies-croissant-butter-4", name: "Butter Croissants 4 Stk", unit_price_cents: 399 },
      { sku: "alfies-orange-juice-1l", name: "Orangensaft 1L", unit_price_cents: 329 },
      { sku: "alfies-berries-mix-250g", name: "Beeren Mix 250g", unit_price_cents: 459 },
      { sku: "alfies-greek-yogurt-500g", name: "Greek Yogurt 500g", unit_price_cents: 319 },
    ],
  },
  {
    key: "default",
    triggers: [],
    title: "Chef Selection Basket",
    altTitle: "Alternative Basket",
    intro: "Ich habe eine erste Auswahl passend zu deiner Anfrage gebaut.",
    eta: "30-40 Minuten",
    items: [
      { sku: "alfies-focaccia", name: "Focaccia", unit_price_cents: 389 },
      { sku: "alfies-burrata", name: "Burrata", unit_price_cents: 469 },
      { sku: "alfies-tomatoes-500g", name: "Cherry Tomatoes 500g", unit_price_cents: 299 },
      { sku: "alfies-sparkling-water-1l", name: "Sparkling Water 1L", unit_price_cents: 129 },
    ],
  },
]

export class ConciergeClient {
  private readonly intentInterpreter?: OpenAIIntentClient

  constructor(args?: { intentInterpreter?: OpenAIIntentClient }) {
    this.intentInterpreter = args?.intentInterpreter
  }

  async call(payload: ConciergePayload): Promise<ConciergeResponse> {
    switch (payload.action) {
      case "test_1cent":
        return buildOneCentResponse(payload)
      case "recipe":
        return buildRecipeResponse(payload, this.intentInterpreter)
      case "alt":
        return buildAlternativeResponse(payload)
      case "confirm":
        return buildConfirmResponse(payload)
      case "cancel":
        return buildCancelResponse(payload)
      case "status":
        return {
          ok: true,
          orderId: payload.orderId,
          text: "Bestellung ist noch in Bearbeitung.",
        }
    }
  }
}

export function responseText(response: ConciergeResponse): string {
  const fallback = Array.isArray(response.messages) ? response.messages.join("\n") : "Alles klar."
  return String(response.text || response.telegram?.text || fallback).trim() || "Alles klar."
}

async function buildRecipeResponse(
  payload: ConciergePayload,
  intentInterpreter?: OpenAIIntentClient,
): Promise<ConciergeResponse> {
  const intent = await resolveIntent(intentInterpreter, payload.message)
  if (intent.replyMode === "clarify" && intent.assistantMessage) {
    return {
      ok: true,
      orderId: payload.orderId,
      text: intent.assistantMessage,
    }
  }
  const parsed = parseRequest(payload.message, intent)
  const draft = createDraftCart(parsed, false)
  return {
    ok: true,
    orderId: payload.orderId,
    recipe: draft.recipe,
    cart: draft.cart,
    eta: draft.eta,
    text: [
      `${draft.recipe.title}`,
      "",
      `${templateFor(parsed).intro} ${describeServings(parsed.servings)}`,
      "",
      "Warenkorb:",
      ...formatCartLines(draft.cart.items),
      "",
      `Zwischensumme: ${formatEur(draft.cart.total_cents)}`,
      `Geplante Lieferzeit: ${draft.eta}`,
      "",
      buildRequestSummary(parsed),
    ].join("\n"),
  }
}

function buildOneCentResponse(payload: ConciergePayload): ConciergeResponse {
  const cart = {
    items: [
      {
        sku: "ALF-TEST-001",
        name: "Gurke 1kg",
        qty: 1,
        unit_price_cents: 1,
      },
    ],
    total_cents: 1,
    currency: "EUR",
  }
  return {
    ok: true,
    orderId: payload.orderId,
    recipe: {
      title: "1-Cent Testbestellung",
    },
    cart,
    eta: "35-50 Minuten",
    text: [
      "1-Cent-Testmodus aktiv.",
      "",
      "Artikel:",
      "- 1x Gurke 1kg (0.01 EUR)",
      "",
      "Zwischensumme: 0.01 EUR",
      "Sende 'order', um die Testbestellung auszufuehren.",
    ].join("\n"),
  }
}

function buildAlternativeResponse(payload: ConciergePayload): ConciergeResponse {
  const parsed = parseRequest(payload.message || inferMessageFromCart(payload.cartState))
  const draft = createDraftCart(parsed, true)
  return {
    ok: true,
    orderId: payload.orderId,
    recipe: draft.recipe,
    cart: draft.cart,
    eta: draft.eta,
    text: [
      `${draft.recipe.title}`,
      "",
      "Hier ist eine Alternative mit leicht anderer Auswahl und Preisstruktur.",
      "",
      "Aktualisierter Warenkorb:",
      ...formatCartLines(draft.cart.items),
      "",
      `Neue Zwischensumme: ${formatEur(draft.cart.total_cents)}`,
      `Geplante Lieferzeit: ${draft.eta}`,
    ].join("\n"),
  }
}

function buildConfirmResponse(payload: ConciergePayload): ConciergeResponse {
  const cart = normalizeCartState(payload.cartState)
  const eta = "35-50 Minuten"
  return {
    ok: true,
    orderId: payload.orderId,
    recipe: { title: inferRecipeTitle(cart) },
    cart,
    eta,
    text: cart.items.length
      ? [
          "Bestellung bestaetigt.",
          `Warenkorb mit ${cart.items.length} Positionen wurde finalisiert.`,
          `Gesamtsumme: ${formatEur(cart.total_cents)}`,
          `ETA: ${eta}`,
        ].join("\n")
      : ["Bestellung bestaetigt.", `ETA: ${eta}`].join("\n"),
  }
}

function buildCancelResponse(payload: ConciergePayload): ConciergeResponse {
  return {
    ok: true,
    orderId: payload.orderId,
    text: "Bestellung abgebrochen. Du kannst jederzeit einen neuen Wunsch schicken.",
  }
}

function parseRequest(message: string | undefined, intent?: ConversationIntent): ParsedRequest {
  const originalText = String(message || "").trim() || "Chef recommendation"
  const normalizedText = normalizeText(originalText)
  return {
    originalText,
    normalizedText,
    servings: intent?.extracted.servings || extractServings(normalizedText),
    dietary: intent?.extracted.dietary?.length ? intent.extracted.dietary : extractDietary(normalizedText),
    category: detectCategory(normalizeText(intent?.extracted.productQuery || normalizedText)),
    occasion: extractOccasion(normalizedText),
  }
}

async function resolveIntent(
  intentInterpreter: OpenAIIntentClient | undefined,
  message: string | undefined,
): Promise<ConversationIntent> {
  const text = String(message || "").trim()
  if (!text) return fallbackIntent("")
  if (!intentInterpreter) return fallbackIntent(text)
  try {
    return await intentInterpreter.interpret({ message: text })
  } catch {
    return fallbackIntent(text)
  }
}

function createDraftCart(parsed: ParsedRequest, alternative: boolean): DraftCart {
  const template = templateFor(parsed)
  const multiplier = Math.max(1, Math.min(parsed.servings, 6))
  const items = template.items.slice(0, 3 + Number(alternative)).map((item, index) => {
    const baseQty = index === 0 ? Math.ceil(multiplier / 2) : 1
    const qty = alternative && index === 1 ? baseQty + 1 : baseQty
    const adjustedPrice = adjustPriceForDietary(item.unit_price_cents, parsed.dietary, alternative)
    return {
      sku: alternative ? `${item.sku}-alt` : item.sku,
      name: alternative ? `${item.name} Alternative` : item.name,
      qty,
      unit_price_cents: adjustedPrice,
    }
  })

  if (parsed.dietary.includes("vegetarian")) {
    items.push({
      sku: alternative ? "alfies-veg-side-alt" : "alfies-veg-side",
      name: alternative ? "Vegetarische Beilage Alternative" : "Vegetarische Beilage",
      qty: 1,
      unit_price_cents: alternative ? 339 : 299,
    })
  }

  if (parsed.dietary.includes("vegan")) {
    items.push({
      sku: alternative ? "alfies-vegan-dip-alt" : "alfies-vegan-dip",
      name: alternative ? "Vegan Dip Alternative" : "Vegan Dip",
      qty: 1,
      unit_price_cents: alternative ? 289 : 259,
    })
  }

  const total = items.reduce((sum, item) => sum + item.qty * item.unit_price_cents, 0)
  const title = buildRecipeTitle(parsed, template, alternative)
  return {
    recipe: { title },
    cart: {
      items,
      total_cents: total,
      currency: "EUR",
    },
    eta: alternative ? shiftEta(template.eta, 5) : template.eta,
  }
}

function normalizeCartState(cartState: CartState | undefined): { items: CartLine[]; total_cents: number; currency: string } {
  const items = Array.isArray(cartState?.items)
    ? cartState.items
        .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
        .map((item) => ({
          sku: String(item.sku || "unknown"),
          name: String(item.name || "Item"),
          qty: normalizePositiveInt(item.qty) || 1,
          unit_price_cents: normalizePositiveInt(item.unit_price_cents) || 0,
        }))
    : []
  const total = typeof cartState?.total_cents === "number"
    ? Math.trunc(cartState.total_cents)
    : items.reduce((sum, item) => sum + item.qty * item.unit_price_cents, 0)
  return {
    items,
    total_cents: total,
    currency: String(cartState?.currency || "EUR"),
  }
}

function detectCategory(text: string): string {
  for (const template of MENU_TEMPLATES) {
    if (template.triggers.some((trigger) => text.includes(trigger))) {
      return template.key
    }
  }
  return "default"
}

function templateFor(parsed: ParsedRequest): MenuTemplate {
  return MENU_TEMPLATES.find((template) => template.key === parsed.category) || MENU_TEMPLATES[MENU_TEMPLATES.length - 1]
}

function extractServings(text: string): number {
  const explicit = text.match(/\bfor\s+(\d+)\b/) || text.match(/\bfur\s+(\d+)\b/) || text.match(/\b(\d+)\s*(people|personen|personen|guests)\b/)
  if (explicit) {
    return clampServings(Number(explicit[1]))
  }
  if (/\bfamily\b|\bgruppe\b/.test(text)) return 4
  if (/\bdate night\b|\bzweisam\b/.test(text)) return 2
  return 2
}

function clampServings(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 2
  return Math.max(1, Math.min(Math.trunc(value), 6))
}

function extractDietary(text: string): string[] {
  const dietary: string[] = []
  if (/\bvegetarian\b|\bveggie\b|\bvegetar/.test(text)) dietary.push("vegetarian")
  if (/\bvegan\b/.test(text)) dietary.push("vegan")
  if (/\bgluten[- ]?free\b|\bglutenfrei\b/.test(text)) dietary.push("gluten-free")
  if (/\bprotein\b|\bhigh protein\b/.test(text)) dietary.push("high-protein")
  return dietary
}

function extractOccasion(text: string): string | undefined {
  if (/\bmovie\b|\bfilm\b/.test(text)) return "movie night"
  if (/\bparty\b/.test(text)) return "party"
  if (/\bbrunch\b/.test(text)) return "brunch"
  return undefined
}

function buildRecipeTitle(parsed: ParsedRequest, template: MenuTemplate, alternative: boolean): string {
  const base = alternative ? template.altTitle : template.title
  const dietaryPrefix = parsed.dietary.length > 0 ? `${capitalize(parsed.dietary[0])} ` : ""
  const occasionSuffix = parsed.occasion ? ` for ${capitalize(parsed.occasion)}` : ""
  return `${dietaryPrefix}${base}${occasionSuffix}`.trim()
}

function buildRequestSummary(parsed: ParsedRequest): string {
  const parts = [
    `Anfrage erkannt: ${parsed.originalText}`,
    `Portionen: ${parsed.servings}`,
  ]
  if (parsed.dietary.length > 0) {
    parts.push(`Praeferenzen: ${parsed.dietary.join(", ")}`)
  }
  return parts.join(" | ")
}

function describeServings(servings: number): string {
  return servings === 1 ? "Portion fuer 1 Person." : `Portionen fuer ${servings} Personen.`
}

function formatCartLines(items: CartLine[]): string[] {
  return items.map((item) => `- ${item.qty}x ${item.name} (${formatEur(item.qty * item.unit_price_cents)})`)
}

function formatEur(cents: number): string {
  return `${(cents / 100).toFixed(2)} EUR`
}

function adjustPriceForDietary(base: number, dietary: string[], alternative: boolean): number {
  let price = base
  if (dietary.includes("gluten-free")) price += 80
  if (dietary.includes("high-protein")) price += 110
  if (alternative) price += 35
  return price
}

function shiftEta(eta: string, deltaMinutes: number): string {
  const match = eta.match(/(\d+)-(\d+)/)
  if (!match) return eta
  return `${Number(match[1]) + deltaMinutes}-${Number(match[2]) + deltaMinutes} Minuten`
}

function inferMessageFromCart(cartState: CartState | undefined): string {
  if (!Array.isArray(cartState?.items) || cartState.items.length === 0) return "alternative"
  const names = cartState.items
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
    .map((item) => String(item.name || "").trim())
    .filter(Boolean)
  return names.join(" ")
}

function inferRecipeTitle(cart: { items: CartLine[] }): string {
  const first = cart.items[0]?.name
  return first ? `Order based on ${first}` : "Order"
}

function normalizePositiveInt(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) return Math.trunc(value)
  if (typeof value === "string" && value.trim()) {
    const n = Number(value)
    if (Number.isFinite(n) && n > 0) return Math.trunc(n)
  }
  return undefined
}

function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

function capitalize(value: string): string {
  return value ? value[0].toUpperCase() + value.slice(1) : value
}
