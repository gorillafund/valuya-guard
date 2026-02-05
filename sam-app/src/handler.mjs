import { withValuya } from "@valuya/aws-lambda-node"

/**
 * Subject resolver
 * Must return { type, id } or null
 * This value becomes:
 *   X-Valuya-Subject: <type>:<id>
 */
function subjectResolver(event) {
  const headers = event.headers || {}

  // 1) Explicit header (best for testing / agents)
  const anonFromHeader =
    headers["x-valuya-subject"] || headers["X-Valuya-Subject"]

  if (anonFromHeader && typeof anonFromHeader === "string") {
    const [type, id] = anonFromHeader.split(":")
    if (type && id) return { type, id }
  }

  // 2) Legacy anon-id header fallback
  const anonId =
    headers["x-valuya-anon-id"] ||
    headers["X-Valuya-Anon-Id"] ||
    headers["x-valuya_anon_id"]

  if (anonId) {
    return { type: "anon", id: String(anonId) }
  }

  // 3) Cookie fallback
  const cookie = headers.cookie || headers.Cookie || ""
  const m = cookie.match(/valuya_anon_id=([^;]+)/)
  if (m?.[1]) {
    return { type: "anon", id: decodeURIComponent(m[1]) }
  }

  return null
}

/**
 * Executed ONLY if Guard authorizes access
 */
async function protectedHandler(event) {
  return {
    statusCode: 200,
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      ok: true,
      message: "Protected content ✅",
    }),
  }
}

export const handler = withValuya({
  // Guard backend
  baseUrl: process.env.VALUYA_BASE_URL, // e.g. https://pay.gorilla.build
  tenanttoken: process.env.VALUYA_SITE_TOKEN, // tenant/site token

  // Authorization target
  resource: process.env.VALUYA_RESOURCE, // e.g. api:path:/premium/article-1
  plan: process.env.VALUYA_PLAN || "pro",

  // Pricing (used ONLY if checkout is required)
  currency: process.env.VALUYA_CURRENCY || "EUR",
  amountCents: Number(process.env.VALUYA_AMOUNT_CENTS || "9900"),

  // Subject resolution
  subjectResolver,

  // What to run if authorized
  onAuthorized: protectedHandler,
})
