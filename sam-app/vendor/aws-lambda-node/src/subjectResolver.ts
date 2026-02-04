import type { Subject } from "@valuya/core"

export function defaultSubject(event: any): Subject {
  const headers = normalizeHeaders(event?.headers)

  // 1) Explicit canonical subject header: X-Valuya-Subject-Id: "anon:526" / "wallet:0x..." / "agent:ci_1"
  const explicit = headers["x-valuya-subject-id"]
  if (explicit) {
    const parsed = parseCanonicalSubject(explicit)
    if (parsed) return parsed
  }

  // 2) Authorizer-derived user id (if present)
  const auth = event?.requestContext?.authorizer
  const maybeUserId =
    auth?.lambda?.user_id ?? auth?.jwt?.claims?.sub ?? auth?.principalId
  if (maybeUserId) return { type: "user", id: String(maybeUserId) }

  // 3) Convenience header: x-valuya-anon-id: 526
  const anon = headers["x-valuya-anon-id"]
  if (anon) return { type: "anon", id: String(anon) }

  // 4) Cookie valuya_anon_id=...
  const cookie = headers["cookie"]
  const cookieAnon = cookie ? readCookie(cookie, "valuya_anon_id") : null
  if (cookieAnon) return { type: "anon", id: cookieAnon }

  // 5) Stable-ish fallback from sourceIp + user-agent (NOT random per request)
  const ip =
    event?.requestContext?.http?.sourceIp ||
    event?.requestContext?.identity?.sourceIp ||
    ""
  const ua = headers["user-agent"] || ""
  const base = `${ip}|${ua}`.trim()

  if (base) return { type: "anon", id: simpleHash(base) }

  // last resort stable fallback (not random)
  return { type: "anon", id: "unknown" }
}

function parseCanonicalSubject(value: string): Subject | null {
  const v = String(value).trim()
  const idx = v.indexOf(":")
  if (idx <= 0) return null
  const type = v.slice(0, idx)
  const id = v.slice(idx + 1)
  if (!type || !id) return null

  // Only allow known types (match core subject model)
  if (
    type === "user" ||
    type === "anon" ||
    type === "agent" ||
    type === "wallet" ||
    type === "api_key"
  ) {
    return { type: type as any, id }
  }
  return null
}

function normalizeHeaders(h: any): Record<string, string> {
  const out: Record<string, string> = {}
  if (!h) return out
  for (const [k, v] of Object.entries(h))
    out[String(k).toLowerCase()] = String(v)
  return out
}

function readCookie(cookieHeader: string, name: string): string | null {
  // minimal cookie parsing
  const parts = cookieHeader.split(";").map((p) => p.trim())
  for (const p of parts) {
    const eq = p.indexOf("=")
    if (eq <= 0) continue
    const k = p.slice(0, eq).trim()
    const v = p.slice(eq + 1).trim()
    if (k === name && v) return decodeURIComponent(v)
  }
  return null
}

function simpleHash(input: string): string {
  let x = 2166136261
  for (let i = 0; i < input.length; i++) {
    x ^= input.charCodeAt(i)
    x = Math.imul(x, 16777619)
  }
  return `anon_${(x >>> 0).toString(16)}`
}
