type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [k: string]: JsonValue }

export function stableJsonStringify(value: any): string {
  return JSON.stringify(stableNormalize(value))
}

export function stableNormalize(value: any): JsonValue {
  if (value === null) return null
  if (typeof value === "string") return value
  if (typeof value === "boolean") return value
  if (typeof value === "number") return Number.isFinite(value) ? value : null

  if (Array.isArray(value)) return value.map(stableNormalize)

  if (typeof value === "object") {
    const out: Record<string, JsonValue> = {}
    const keys = Object.keys(value).sort()
    for (const k of keys) out[k] = stableNormalize(value[k])
    return out
  }

  return null
}
