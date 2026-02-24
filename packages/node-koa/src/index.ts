import { paymentRequiredResponseV2, type GuardRequired } from "@valuya/core"

type Subject = { type: string; id: string }

type KoaLike = {
  method?: string
  path?: string
  request: { headers?: Record<string, string | string[] | undefined> }
  response: { set(name: string, v: string): void }
  status: number
  body: any
  redirect(url: string): void
}

export type ValuyaKoaOptions = {
  resource?: string
  plan?: string
  base?: string
  tenantToken?: string
  subject?: (ctx: KoaLike) => Subject
}

export function valuyaKoa(opts: ValuyaKoaOptions = {}) {
  const base = opts.base || process.env.VALUYA_BASE || ""
  const tenantToken = opts.tenantToken || process.env.VALUYA_TENANT_TOKEN || process.env.VALUYA_SITE_TOKEN || ""
  const plan = (opts.plan || process.env.VALUYA_PLAN || "pro").trim() || "pro"

  return async (ctx: KoaLike, next: () => Promise<unknown>) => {
    const subject = opts.subject ? opts.subject(ctx) : defaultSubject(ctx.request.headers)
    const resource = (opts.resource || process.env.VALUYA_RESOURCE || "").trim() || `http:route:${String(ctx.method || "GET").toUpperCase()}:${ctx.path || "/"}`

    const ent = await fetchEntitlements(base, tenantToken, plan, resource, subject)
    if (ent?.active === true) return next()

    const required: GuardRequired = (ent as any)?.required ?? { type: "subscription", plan }
    const evaluatedPlan = (ent as any)?.evaluated_plan || plan
    const session = await createCheckout(base, tenantToken, evaluatedPlan, resource, subject, required)

    const accept = String((ctx.request.headers || {})["accept"] || "")
    if (accept.includes("text/html") && session.payment_url) {
      ctx.response.set("X-Valuya-Session-Id", session.session_id)
      ctx.redirect(session.payment_url)
      return
    }

    const pr = paymentRequiredResponseV2({
      reason: (ent as any)?.reason || "payment_required",
      required,
      evaluated_plan: evaluatedPlan,
      resource,
      session_id: session.session_id,
      payment_url: session.payment_url,
      payment: session.payment,
    })
    ctx.status = pr.status
    for (const [k, v] of Object.entries(pr.headers)) ctx.response.set(k, v)
    ctx.body = JSON.parse(pr.body)
  }
}

function defaultSubject(h?: Record<string, string | string[] | undefined>): Subject {
  const raw = String(h?.["x-valuya-subject-id"] || "")
  if (raw.includes(":")) {
    const [type, ...rest] = raw.split(":")
    return { type, id: rest.join(":") }
  }
  return { type: "anon", id: String(h?.["x-valuya-anon-id"] || "unknown") }
}

async function fetchEntitlements(base: string, token: string, plan: string, resource: string, subject: Subject) {
  const url = new URL(`${base.replace(/\/+$/, "")}/api/v2/entitlements`)
  url.searchParams.set("plan", plan)
  url.searchParams.set("resource", resource)
  const headers: Record<string, string> = {
    Accept: "application/json",
    "X-Valuya-Subject-Id": `${subject.type}:${subject.id}`,
    "X-Valuya-Subject-Type": subject.type,
    "X-Valuya-Subject-Id-Raw": subject.id,
  }
  if (token) headers.Authorization = `Bearer ${token}`
  const r = await fetch(url.toString(), { headers })
  const t = await r.text()
  if (!r.ok) throw new Error(`valuya_entitlements_failed:${r.status}:${t.slice(0,300)}`)
  return t ? JSON.parse(t) : {}
}

async function createCheckout(base: string, token: string, plan: string, resource: string, subject: Subject, required: GuardRequired) {
  const url = `${base.replace(/\/+$/, "")}/api/v2/checkout/sessions`
  const headers: Record<string, string> = {
    Accept: "application/json",
    "Content-Type": "application/json",
    "X-Valuya-Subject-Id": `${subject.type}:${subject.id}`,
    "X-Valuya-Subject-Type": subject.type,
    "X-Valuya-Subject-Id-Raw": subject.id,
  }
  if (token) headers.Authorization = `Bearer ${token}`
  const r = await fetch(url, { method: "POST", headers, body: JSON.stringify({ plan, evaluated_plan: plan, resource, subject, required, currency: "EUR", amount_cents: 1 }) })
  const t = await r.text()
  if (!r.ok) throw new Error(`valuya_checkout_failed:${r.status}:${t.slice(0,300)}`)
  const j = t ? JSON.parse(t) : {}
  return { session_id: j.session_id, payment_url: j.payment_url ?? "", payment: j.payment }
}
