import { paymentRequiredResponseV2, type GuardRequired } from "@valuya/core"

export type Subject = { type: string; id: string }

export type ValuyaNextOptions = {
  base?: string
  tenantToken?: string
  plan?: string
  resource?: (request: Request) => string
  subject?: (request: Request) => Subject
  successUrl?: string
  cancelUrl?: string
}

export function withValuyaNextRoute(
  opts: ValuyaNextOptions,
  handler: (request: Request, context?: unknown) => Promise<Response> | Response,
) {
  const base = opts.base || process.env.VALUYA_BASE || ""
  const tenantToken = opts.tenantToken || process.env.VALUYA_TENANT_TOKEN || process.env.VALUYA_SITE_TOKEN || ""
  const plan = (opts.plan || process.env.VALUYA_PLAN || "pro").trim() || "pro"

  return async (request: Request, context?: unknown): Promise<Response> => {
    const subject = opts.subject ? opts.subject(request) : defaultSubject(request)
    const resource =
      (process.env.VALUYA_RESOURCE || "").trim() ||
      (opts.resource ? opts.resource(request) : httpRouteResource(request.method, new URL(request.url).pathname))

    const ent = await fetchEntitlements(base, tenantToken, plan, resource, subject)
    if (ent.active === true) return handler(request, context)

    const required: GuardRequired = (ent as any).required ?? { type: "subscription", plan }
    const evaluatedPlan = (ent as any).evaluated_plan || plan
    const session = await createCheckout(base, tenantToken, evaluatedPlan, resource, subject, required, opts.successUrl, opts.cancelUrl)

    const accept = request.headers.get("accept") || ""
    if (accept.includes("text/html") && session.payment_url) {
      return Response.redirect(session.payment_url, 302)
    }

    const pr = paymentRequiredResponseV2({
      reason: (ent as any).reason || "payment_required",
      required,
      evaluated_plan: evaluatedPlan,
      resource,
      session_id: session.session_id,
      payment_url: session.payment_url,
      payment: session.payment,
    })

    return new Response(pr.body, { status: pr.status, headers: pr.headers })
  }
}

function defaultSubject(request: Request): Subject {
  const raw = request.headers.get("x-valuya-subject-id")
  if (raw && raw.includes(":")) {
    const [type, ...rest] = raw.split(":")
    return { type, id: rest.join(":") }
  }
  return { type: "anon", id: request.headers.get("x-valuya-anon-id") || "unknown" }
}

function httpRouteResource(method: string, path: string): string {
  return `http:route:${method.toUpperCase()}:${path || "/"}`
}

async function fetchEntitlements(base: string, token: string, plan: string, resource: string, subject: Subject) {
  const u = new URL(`${normalizeBase(base)}/api/v2/entitlements`)
  u.searchParams.set("plan", plan)
  u.searchParams.set("resource", resource)

  const headers = new Headers({
    Accept: "application/json",
    "X-Valuya-Subject-Id": `${subject.type}:${subject.id}`,
    "X-Valuya-Subject-Type": subject.type,
    "X-Valuya-Subject-Id-Raw": subject.id,
  })
  if (token) headers.set("Authorization", `Bearer ${token}`)

  const r = await fetch(u.toString(), { method: "GET", headers })
  const t = await r.text()
  if (!r.ok) throw new Error(`valuya_entitlements_failed:${r.status}:${t.slice(0, 300)}`)
  return t ? JSON.parse(t) : {}
}

async function createCheckout(
  base: string,
  token: string,
  plan: string,
  resource: string,
  subject: Subject,
  required: GuardRequired,
  successUrl?: string,
  cancelUrl?: string,
) {
  const headers = new Headers({
    Accept: "application/json",
    "Content-Type": "application/json",
    "X-Valuya-Subject-Id": `${subject.type}:${subject.id}`,
    "X-Valuya-Subject-Type": subject.type,
    "X-Valuya-Subject-Id-Raw": subject.id,
  })
  if (token) headers.set("Authorization", `Bearer ${token}`)

  const r = await fetch(`${normalizeBase(base)}/api/v2/checkout/sessions`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      plan,
      evaluated_plan: plan,
      resource,
      subject,
      required,
      success_url: successUrl || "",
      cancel_url: cancelUrl || "",
      currency: "EUR",
      amount_cents: 1,
    }),
  })
  const t = await r.text()
  if (!r.ok) throw new Error(`valuya_checkout_failed:${r.status}:${t.slice(0, 300)}`)
  const j = t ? JSON.parse(t) : {}
  if (!j.session_id) throw new Error("valuya_checkout_invalid_response")
  return { session_id: j.session_id, payment_url: j.payment_url ?? "", payment: j.payment }
}

function normalizeBase(base: string): string {
  return String(base || "").replace(/\/+$/, "")
}
