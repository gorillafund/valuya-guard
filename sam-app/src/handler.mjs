import { withValuya } from "@valuya/aws-lambda-node"

function subjectResolver(event) {
  const headers = event.headers || {}

  // Prefer canonical header: X-Valuya-Subject-Id: "user:526" / "anon:abc"
  const canonical =
    headers["x-valuya-subject-id"] ||
    headers["X-Valuya-Subject-Id"] ||
    headers["x-valuya-subject"] ||
    headers["X-Valuya-Subject"]

  if (canonical && typeof canonical === "string") {
    // allow "type:id" even if id contains ":" -> split only first
    const idx = canonical.indexOf(":")
    if (idx > 0) {
      const type = canonical.slice(0, idx)
      const id = canonical.slice(idx + 1)
      if (type && id) return { type, id }
    }
  }

  // legacy anon header
  const anonId =
    headers["x-valuya-anon-id"] ||
    headers["X-Valuya-Anon-Id"] ||
    headers["x-valuya_anon_id"]

  if (anonId) return { type: "anon", id: String(anonId) }

  // cookie fallback
  const cookie = headers.cookie || headers.Cookie || ""
  const m = String(cookie).match(/valuya_anon_id=([^;]+)/)
  if (m?.[1]) return { type: "anon", id: decodeURIComponent(m[1]) }

  return null
}

async function protectedHandler(event) {
  return {
    statusCode: 200,
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ok: true, message: "Protected content ✅" }),
  }
}

// IMPORTANT: pass protectedHandler as SECOND argument
export const handler = withValuya(
  {
    // NOTE: your package likely expects `valuyaBase` + `tenanttoken` (not baseUrl)
    valuyaBase: process.env.VALUYA_BASE_URL || process.env.VALUYA_BASE || "",
    tenanttoken: process.env.VALUYA_SITE_TOKEN || "",

    resource: process.env.VALUYA_RESOURCE || "",
    plan: process.env.VALUYA_PLAN || "pro",

    currency: process.env.VALUYA_CURRENCY || "EUR",
    amountCents: Number(process.env.VALUYA_AMOUNT_CENTS || "9900"),

    subject: subjectResolver,

    successUrl: process.env.VALUYA_SUCCESS_URL,
    cancelUrl: process.env.VALUYA_CANCEL_URL,
  },
  protectedHandler,
)
