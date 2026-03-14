import type { CartState, PendingOption } from "./stateStore.js"
import { formatPendingOptionsMessage } from "./optionSelectionService.js"

export function formatAgentCategoryReply(args: {
  prompt: string
  options: PendingOption[]
  hasMore?: boolean
  acknowledgment?: string | null
}): string {
  return joinSections([args.acknowledgment || null, formatPendingOptionsMessage(args.prompt, args.options)])
}

export function formatAgentProductReply(args: {
  prompt: string
  options: PendingOption[]
  hasMore?: boolean
  acknowledgment?: string | null
}): string {
  return joinSections([args.acknowledgment || null, formatPendingOptionsMessage(args.prompt, args.options)])
}

export function formatAgentRecipeReply(args: {
  recipeTitle: string
  options: PendingOption[]
  unresolvedIngredients: string[]
  acknowledgment?: string | null
}): string {
  const lines = [
    `Fuer ${args.recipeTitle} habe ich erstmal diese passenden Zutaten im Alfies-Katalog gefunden:`,
    "",
    ...args.options.map((option, index) => `${index + 1}. ${option.label}`),
  ]
  if (args.unresolvedIngredients.length > 0) {
    lines.push("")
    lines.push(`Noch offen: ${args.unresolvedIngredients.slice(0, 4).join(", ")}`)
  }
  lines.push("")
  lines.push("Antworte mit der Nummer oder dem Namen.")
  return joinSections([args.acknowledgment || null, lines.join("\n")])
}

export function formatAgentDirectAnswer(text: string, acknowledgment?: string | null): string {
  return joinSections([acknowledgment || null, text])
}

export function formatAgentCartMutationReply(args: {
  message: string
  cart: CartState
  acknowledgment?: string | null
}): string {
  const items = Array.isArray(args.cart.items) ? args.cart.items : []
  const lines = [
    args.message,
    "",
    "Aktueller Warenkorb:",
    ...items.slice(0, 8).map((item, index) => formatCartLine(item, index + 1)),
    "",
    `Zwischensumme: ${formatCurrency(args.cart.total_cents, args.cart.currency)}`,
    "",
    "Naechste Schritte: 'order' zum Bestellen, 'Warenkorb' zum Bearbeiten, 'alt' fuer Alternativen.",
    "Du kannst auch etwas ergaenzen, z.B. 'auch Milch' oder 'fuege 2x Hafermilch hinzu'.",
  ]
  return joinSections([args.acknowledgment || null, lines.join("\n")])
}

function joinSections(parts: Array<string | null | undefined>): string {
  return parts
    .map((part) => String(part || "").trim())
    .filter(Boolean)
    .join("\n\n")
}

function formatCartLine(item: unknown, index: number): string {
  const row = item && typeof item === "object" ? item as Record<string, unknown> : {}
  const qty = Math.max(1, Math.trunc(Number(row.qty || 1)))
  const title = String(row.name || row.title || "Artikel")
  const lineTotal = Math.trunc(Number(row.line_total_cents || qty * Math.trunc(Number(row.unit_price_cents || 0))))
  const currency = String(row.currency || "EUR")
  return `${index}. ${qty}x ${title} (${formatCurrency(lineTotal, currency)})`
}

function formatCurrency(cents: unknown, currency: unknown): string {
  const value = Math.trunc(Number(cents || 0))
  const code = String(currency || "EUR")
  return `${(value / 100).toFixed(2)} ${code}`
}
