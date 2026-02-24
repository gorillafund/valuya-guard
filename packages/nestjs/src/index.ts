import { paymentRequiredResponseV2, type GuardRequired, type EntitlementsResponse } from "@valuya/core"

type Subject = { type: string; id: string }

type GuardClientConfig = { base: string; tenantToken?: string }

type ReqLike = {
  method?: string
  path?: string
  originalUrl?: string
  url?: string
  headers?: Record<string, string | string[] | undefined>
}

type ResLike = {
  status(code: number): ResLike
  setHeader(name: string, value: string): void
  json(body: unknown): void
  redirect(url: string): void
}

type NextFn = () => void | Promise<void>

export type ValuyaNestOptions = {
  resource?: string
  plan?: string
  base?: string
  tenantToken?: string
  subject?: (req: ReqLike) => Subject
  successUrl?: string
  cancelUrl?: string
}

export function valuyaNest(opts: ValuyaNestOptions = {}) {
  const base = opts.base || process.env.VALUYA_BASE || ""
  const tenantToken = opts.tenantToken || process.env.VALUYA_TENANT_TOKEN || process.env.VALUYA_SITE_TOKEN || ""
  const plan = (opts.plan || process.env.VALUYA_PLAN || "pro").trim() || "pro"

  return async (req: ReqLike, res: ResLike, next: NextFn) => {
    const subject = opts.subject ? opts.subject(req) : defaultSubject(req)
    const path = req.path || req.originalUrl || req.url || "/"
    const resource = (opts.resource || process.env.VALUYA_RESOURCE || "").trim() || httpRouteResource(req.method || "GET", path)

    const cfg: GuardClientConfig = { base, tenantToken: tenantToken || undefined }
    const ent = await fetchEntitlements({ cfg, plan, resource, subject })
    if (ent.active === true) return next()

    const required: GuardRequired = (ent as any).required ?? { type: "subscription", plan }
    const evaluatedPlan = (ent as any).evaluated_plan || plan

    const session = await createCheckoutSession({
      cfg,
      plan: evaluatedPlan,
      resource,
      subject,
      required,
      successUrl: opts.successUrl,
      cancelUrl: opts.cancelUrl,
      idempotencyKey: makeIdempotencyKey(subject, resource, required, evaluatedPlan),
    })

    const accept = String((req.headers || {})["accept"] || "")
    if (accept.includes("text/html") && session.payment_url) {
      res.setHeader("X-Valuya-Session-Id", session.session_id)
      return res.redirect(session.payment_url)
    }

    const pr = paymentRequiredResponseV2({
      reason: (ent as any).reason || "payment_required",
      required,
      evaluated_plan: evaluatedPlan,
      resource,
      session_id: session.session_id,
      payment_url: session.payment_url,
      payment: (session as any).payment,
    })

    res.status(pr.status)
    for (const [k, v] of Object.entries(pr.headers)) res.setHeader(k, String(v))
    return res.json(JSON.parse(pr.body))
  }
}

function defaultSubject(req: ReqLike): Subject {
  const h = normalizeHeaders(req.headers)
  const explicit = h["x-valuya-subject-id"]
  if (explicit && explicit.includes(":")) {
    const [type, ...rest] = explicit.split(":")
    return { type, id: rest.join(":") }
  }
  const anon = h["x-valuya-anon-id"]
  if (anon) return { type: "anon", id: anon }
  return { type: "anon", id: "unknown" }
}

function normalizeHeaders(h: ReqLike["headers"]): Record<string, string> {
  const out: Record<string, string> = {}
  if (!h) return out
  for (const [k, v] of Object.entries(h)) out[k.toLowerCase()] = Array.isArray(v) ? v.join(",") : String(v || "")
  return out
}

function httpRouteResource(method: string, path: string): string {
  return `http:route:${String(method).toUpperCase()}:${path || "/"}`
}

function makeIdempotencyKey(subject: Subject, resource: string, required: any, plan: string): string {
  return `vg:${subject.type}:${subject.id}|${resource}|${required.type}|${plan}|${JSON.stringify(required)}`
}

async function fetchEntitlements(args: { cfg: GuardClientConfig; plan: string; resource: string; subject: Subject }): Promise<EntitlementsResponse> {
  const url = new URL(normalizeBase(args.cfg.base) + "/api/v2/entitlements")
  url.searchParams.set("plan", args.plan)
  url.searchParams.set("resource", args.resource)
  const headers: Record<string, string> = {
    Accept: "application/json",
    "X-Valuya-Subject-Id": `${args.subject.type}:${args.subject.id}`,
    "X-Valuya-Subject-Type": args.subject.type,
    "X-Valuya-Subject-Id-Raw": args.subject.id,
  }
  if (args.cfg.tenantToken) headers.Authorization = `Bearer ${args.cfg.tenantToken}`
  const resp = await fetch(url.toString(), { headers })
  const txt = await resp.text()
  if (!resp.ok) throw new Error(`valuya_entitlements_failed:${resp.status}:${txt.slice(0, 300)}`)
  return txt ? JSON.parse(txt) : ({ active: false } as any)
}

async function createCheckoutSession(args: { cfg: GuardClientConfig; plan: string; resource: string; subject: Subject; required: GuardRequired; successUrl?: string; cancelUrl?: string; idempotencyKey?: string }) {
  const url = normalizeBase(args.cfg.base) + "/api/v2/checkout/sessions"
  const headers: Record<string, string> = {
    Accept: "application/json",
    "Content-Type": "application/json",
    "X-Valuya-Subject-Id": `${args.subject.type}:${args.subject.id}`,
    "X-Valuya-Subject-Type": args.subject.type,
    "X-Valuya-Subject-Id-Raw": args.subject.id,
  }
  if (args.cfg.tenantToken) headers.Authorization = `Bearer ${args.cfg.tenantToken}`
  if (args.idempotencyKey) headers["Idempotency-Key"] = args.idempotencyKey
  const resp = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({
      plan: args.plan,
      evaluated_plan: args.plan,
      resource: args.resource,
      subject: args.subject,
      required: args.required,
      success_url: args.successUrl || "",
      cancel_url: args.cancelUrl || "",
      idempotency_key: args.idempotencyKey || "",
      currency: "EUR",
      amount_cents: 1,
    }),
  })
  const txt = await resp.text()
  if (!resp.ok) throw new Error(`valuya_checkout_failed:${resp.status}:${txt.slice(0, 300)}`)
  const j = txt ? JSON.parse(txt) : {}
  if (!j.session_id) throw new Error("valuya_checkout_invalid_response")
  return { session_id: j.session_id, payment_url: j.payment_url ?? "", payment: j.payment }
}

function normalizeBase(base: string): string {
  return String(base || "").replace(/\/+$/, "")
}
