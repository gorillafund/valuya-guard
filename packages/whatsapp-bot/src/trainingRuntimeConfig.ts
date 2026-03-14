import { existsSync, readFileSync } from "node:fs"
import { resolve } from "node:path"

export type AcceptedTrainingRuntimeConfig = {
  accepted_aliases_by_family: Record<string, string[]>
}

export function loadAcceptedTrainingRuntimeConfig(): AcceptedTrainingRuntimeConfig {
  const file = resolveAcceptedTrainingFile()
  if (!file) {
    return { accepted_aliases_by_family: {} }
  }
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8")) as Partial<AcceptedTrainingRuntimeConfig>
    if (!parsed.accepted_aliases_by_family || typeof parsed.accepted_aliases_by_family !== "object") {
      return { accepted_aliases_by_family: {} }
    }
    const aliases = Object.fromEntries(
      Object.entries(parsed.accepted_aliases_by_family).map(([family, values]) => [
        normalize(family),
        Array.isArray(values) ? values.map((value) => String(value || "").trim()).filter(Boolean) : [],
      ]),
    )
    return { accepted_aliases_by_family: aliases }
  } catch {
    return { accepted_aliases_by_family: {} }
  }
}

export function mergeAcceptedAliasesIntoSignals(
  baseSignals: Record<string, string[]>,
  accepted: AcceptedTrainingRuntimeConfig = loadAcceptedTrainingRuntimeConfig(),
): Record<string, string[]> {
  const merged = new Map<string, Set<string>>()
  for (const [family, values] of Object.entries(baseSignals)) {
    merged.set(normalize(family), new Set(values.map((value) => normalize(value)).filter(Boolean)))
  }
  for (const [family, aliases] of Object.entries(accepted.accepted_aliases_by_family)) {
    const current = merged.get(normalize(family)) || new Set<string>()
    for (const alias of aliases) {
      const normalizedAlias = normalize(alias)
      if (normalizedAlias) current.add(normalizedAlias)
    }
    merged.set(normalize(family), current)
  }
  return Object.fromEntries(
    Array.from(merged.entries()).map(([family, values]) => [family, Array.from(values)]),
  )
}

function resolveAcceptedTrainingFile(): string | null {
  const candidates = [
    process.env.WHATSAPP_TRAINING_ACCEPTED_FILE?.trim(),
    resolve(process.cwd(), "training-accepted-proposals.json"),
    resolve(process.cwd(), "packages/whatsapp-bot/training-accepted-proposals.json"),
  ].filter(Boolean) as string[]

  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate
  }
  return null
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
