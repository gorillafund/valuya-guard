import { createHash } from "node:crypto"

function stableNormalize(v: any): any {
  if (Array.isArray(v)) return v.map(stableNormalize)

  if (v && typeof v === "object") {
    const out: Record<string, any> = {}
    for (const k of Object.keys(v).sort()) {
      const vv = v[k]
      if (vv === undefined) continue
      out[k] = stableNormalize(vv)
    }
    return out
  }

  return v
}

export function stableJson(value: any): string {
  const normalized = stableNormalize(value)
  return JSON.stringify(normalized)
}

export function sha256HexUtf8(s: string): string {
  return createHash("sha256").update(s, "utf8").digest("hex")
}
