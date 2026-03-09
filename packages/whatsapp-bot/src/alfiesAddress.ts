import type { AlfiesAddressInput } from "./alfiesClient.js"

export type ParsedAddressHint = {
  line1: string
  house: string
  postcode: string
  city: string
}

export function parseAddressHint(input: string): ParsedAddressHint | null {
  const raw = String(input || "").trim()
  if (!raw) return null

  const normalized = raw.replace(/\s+/g, " ").trim()
  const parts = normalized.split(",").map((part) => part.trim()).filter(Boolean)
  if (parts.length < 2) return null

  const streetPart = parts[0]
  const cityPart = parts[1]

  const streetMatch = /^(.*\D)\s+([0-9]+[a-zA-Z0-9\/-]*)$/.exec(streetPart)
  const cityMatch = /^(\d{4,5})\s+(.+)$/.exec(cityPart)
  if (!streetMatch || !cityMatch) return null

  return {
    line1: streetMatch[1].trim(),
    house: streetMatch[2].trim(),
    postcode: cityMatch[1].trim(),
    city: cityMatch[2].trim(),
  }
}

export function buildSessionAddress(args: {
  addressHint: string
  latitude: number
  longitude: number
  shippingMethod?: string
  phone?: string
}): AlfiesAddressInput | null {
  const parsed = parseAddressHint(args.addressHint)
  if (!parsed) return null
  return {
    ...parsed,
    latitude: args.latitude,
    longitude: args.longitude,
    shippingMethod: args.shippingMethod,
    phone: args.phone,
    query: args.addressHint,
  }
}

export function summarizeShippingMethods(input: unknown): string | undefined {
  if (!input || typeof input !== "object") return undefined
  const record = input as Record<string, unknown>
  const entries = Object.values(record)
    .filter((value): value is Record<string, unknown> => Boolean(value) && typeof value === "object")
    .slice(0, 3)
    .map((value) => {
      const name = String(value.name || value.code || "Shipping option").trim()
      const date = String(value.date || "").trim()
      return date ? `${name} (${date})` : name
    })
    .filter(Boolean)
  return entries.length > 0 ? entries.join(", ") : undefined
}
