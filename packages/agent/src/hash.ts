import crypto from "crypto"

export function stableStringify(x: any): string {
  if (Array.isArray(x)) return `[${x.map(stableStringify).join(",")}]`
  if (x && typeof x === "object") {
    const keys = Object.keys(x).sort()
    return `{${keys.map((k) => JSON.stringify(k) + ":" + stableStringify(x[k])).join(",")}}`
  }
  return JSON.stringify(x)
}

export function sha256Hex(input: string): string {
  return crypto.createHash("sha256").update(input).digest("hex")
}
