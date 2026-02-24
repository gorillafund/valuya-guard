import { paymentRequiredResponseV2, type GuardRequired } from "@valuya/core"

export type WorkerOptions = {
  base?: string
  tenantToken?: string
  plan?: string
  resource?: string
  subject?: (request: Request) => { type: string; id: string }
}

export function withValuyaWorker(
  opts: WorkerOptions,
  handler: (request: Request, env?: any, ctx?: any) => Promise<Response> | Response,
) {
  const base = opts.base || ""
  const tenantToken = opts.tenantToken || ""
  const plan = (opts.plan || "pro").trim() || "pro"

  return async (request: Request, env?: any, ctx?: any): Promise<Response> => {
    const subject = opts.subject ? opts.subject(request) : defaultSubject(request)
    const resource = opts.resource || `http:route:${request.method.toUpperCase()}:${new URL(request.url).pathname}`

    const ent = await fetchEntitlements(base, tenantToken, plan, resource, subject)
    if (ent.active === true) return handler(request, env, ctx)

    const required: GuardRequired = (ent as any).required ?? { type: "subscription", plan }
    const evaluatedPlan = (ent as any).evaluated_plan || plan
    const session = await createCheckout(base, tenantToken, evaluatedPlan, resource, subject, required)

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

function defaultSubject(request: Request): { type: string; id: string } {
  const raw = request.headers.get("x-valuya-subject-id")
  if (raw && raw.includes(":")) {
    const [type, ...rest] = raw.split(":")
    return { type, id: rest.join(":") }
  }
  return { type: "anon", id: request.headers.get("x-valuya-anon-id") || "unknown" }
}

async function fetchEntitlements(base: string, token: string, plan: string, resource: string, subject: { type: string; id: string }) {
  const u = new URL(`${String(base).replace(/\/+$/, "")}/api/v2/entitlements`)
  u.searchParams.set("plan", plan)
  u.searchParams.set("resource", resource)
  const headers = new Headers({
    Accept: "application/json",
    "X-Valuya-Subject-Id": `${subject.type}:${subject.id}`,
    "X-Valuya-Subject-Type": subject.type,
    "X-Valuya-Subject-Id-Raw": subject.id,
  })
  if (token) headers.set("Authorization", `Bearer ${token}`)
  const r = await fetch(u.toString(), { headers })
  const t = await r.text()
  if (!r.ok) throw new Error(`valuya_entitlements_failed:${r.status}:${t.slice(0, 300)}`)
  return t ? JSON.parse(t) : {}
}

async function createCheckout(base: string, token: string, plan: string, resource: string, subject: { type: string; id: string }, required: GuardRequired) {
  const headers = new Headers({
    Accept: "application/json",
    "Content-Type": "application/json",
    "X-Valuya-Subject-Id": `${subject.type}:${subject.id}`,
    "X-Valuya-Subject-Type": subject.type,
    "X-Valuya-Subject-Id-Raw": subject.id,
  })
  if (token) headers.set("Authorization", `Bearer ${token}`)
  const r = await fetch(`${String(base).replace(/\/+$/, "")}/api/v2/checkout/sessions`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      plan,
      evaluated_plan: plan,
      resource,
      subject,
      required,
      currency: "EUR",
      amount_cents: 1,
    }),
  })
  const t = await r.text()
  if (!r.ok) throw new Error(`valuya_checkout_failed:${r.status}:${t.slice(0, 300)}`)
  const j = t ? JSON.parse(t) : {}
  return { session_id: j.session_id, payment_url: j.payment_url ?? "", payment: j.payment }
}
