import { withValuya } from "@valuya/aws-lambda-node"

// POC subject resolver:
// - Prefer a stable cookie you already set in WP/Laravel (e.g. valuya_anon_id)
// - Fallback: x-valuya-anon-id header (easy for testing)
// IMPORTANT: Must return { type, id } or null
function subjectResolver(event) {
  const headers = event.headers || {}

  // header-based (easy test)
  const anonFromHeader =
    headers["x-valuya-anon-id"] ||
    headers["X-Valuya-Anon-Id"] ||
    headers["x-valuya_anon_id"]

  if (anonFromHeader) {
    return { type: "anon", id: String(anonFromHeader) }
  }

  // cookie-based
  const cookie = headers.cookie || headers.Cookie || ""
  const m = cookie.match(/valuya_anon_id=([^;]+)/)
  if (m?.[1]) {
    return { type: "anon", id: decodeURIComponent(m[1]) }
  }

  return null
}

async function protectedHandler(event) {
  return {
    statusCode: 200,
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ok: true, message: "Protected content ✅" }),
  }
}

export const handler = withValuya({
  baseUrl: process.env.VALUYA_BASE_URL, // e.g. https://pay.gorilla.build
  tenanttoken: process.env.VALUYA_SITE_TOKEN, // shared secret for guard endpoints
  resource: process.env.VALUYA_RESOURCE, // e.g. wp:path:/premium/article-1/
  plan: process.env.VALUYA_PLAN || "pro",
  currency: process.env.VALUYA_CURRENCY || "EUR",
  amountCents: Number(process.env.VALUYA_AMOUNT_CENTS || "9900"),
  successUrl: process.env.VALUYA_SUCCESS_URL, // where user returns after payment
  cancelUrl: process.env.VALUYA_CANCEL_URL,
  checkoutBase: process.env.VALUYA_CHECKOUT_BASE || "", // optional override
  subjectResolver,
  onAuthorized: protectedHandler,
})
