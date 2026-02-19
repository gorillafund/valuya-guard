export function parseIsoToMs(iso: string): number {
  const ms = Date.parse(iso)
  if (!Number.isFinite(ms)) throw new Error(`Invalid ISO time: ${iso}`)
  return ms
}

export function isoFromMs(ms: number): string {
  const d = new Date(ms)
  const t = d.toISOString()
  if (!t || t === "Invalid Date") throw new Error("Invalid ms for ISO")
  return t
}

export function clampTtlSeconds(v: number, min: number, max: number): number {
  const x = Math.floor(Number(v))
  if (!Number.isFinite(x)) return min
  return Math.min(max, Math.max(min, x))
}
