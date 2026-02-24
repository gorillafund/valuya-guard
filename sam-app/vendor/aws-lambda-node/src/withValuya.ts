import type { GuardRequired } from "@valuya/core"
import { paymentRequiredResponseV2 } from "@valuya/core"
import { defaultSubject } from "./subjectResolver.js"
import { fetchEntitlements, createCheckoutSession } from "./guardClient.js"
import type { LambdaHandler, WithValuyaOptions } from "./types.js"

export function withValuya(
  opts: WithValuyaOptions,
  handler: LambdaHandler,
): LambdaHandler {
  const valuyaBase = opts.valuyaBase || process.env.VALUYA_BASE || ""
  const tenant_token = opts.tenant_token || process.env.VALUYA_SITE_TOKEN || ""

  // IMPORTANT: use VALUYA_PLAN (matches your SAM template)
  const plan = (opts.plan || process.env.VALUYA_PLAN || "pro").trim() || "pro"

  return async (event: any, context: any) => {
    const subject = opts.subject ? opts.subject(event) : defaultSubject(event)
    const subjectWire = { type: subject.type, id: subject.id }

    // Resource resolution:
    // 1) explicit opts.resource
    // 2) env override (VALUYA_RESOURCE)
    // 3) derive from HTTP method/path
    const resource =
      (opts.resource || process.env.VALUYA_RESOURCE || "").trim() ||
      deriveHttpResource(event)

    if (!resource) throw new Error("withValuya: missing resource")

    const ent = await fetchEntitlements({
      cfg: { base: valuyaBase, tenant_token: tenant_token || undefined },
      plan,
      resource,
      subject: subjectWire,
    })

    if (ent?.active === true) {
      const res = await handler(event, context)
      return ensureJsonHeaders(res)
    }

    // Backend should ideally return `required` + `evaluated_plan`.
    const required: GuardRequired = (ent as any)?.required ?? {
      type: "subscription",
      plan,
    }

    const evaluatedPlan = (ent as any)?.evaluated_plan || plan

    const idempotencyKey = makeIdempotencyKey(
      subjectWire,
      resource,
      required,
      evaluatedPlan,
    )

    const session = await createCheckoutSession({
      cfg: { base: valuyaBase, tenant_token: tenant_token || undefined },
      plan: evaluatedPlan,
      resource,
      subject: subjectWire,
      required,
      currency: "EUR",
      amountCents: 1,
      successUrl: opts.successUrl,
      cancelUrl: opts.cancelUrl,
      idempotencyKey,
    })

    // RFC: HTML → redirect (still after checkout session creation)

    // Browser flow (UI)
    if (wantsHtml(event) && session.payment_url) {
      return {
        statusCode: 302,
        headers: {
          Location: session.payment_url,
          "X-Valuya-Session-Id": session.session_id,
        },
        body: "",
      }
    }

    // Agent / API flow
    const resp = paymentRequiredResponseV2({
      reason: (ent as any)?.reason || "payment_required",
      required,
      evaluated_plan: evaluatedPlan,
      resource,
      session_id: session.session_id,

      // IMPORTANT:
      payment_url: session.payment_url,
      payment: session.payment ?? undefined,
    })

    return {
      statusCode: resp.status,
      headers: resp.headers,
      body: resp.body,
    }
  }
}

function ensureJsonHeaders(res: any) {
  const headers = { ...(res.headers || {}) }
  if (!headers["Content-Type"] && !headers["content-type"]) {
    headers["Content-Type"] = "application/json; charset=utf-8"
  }
  return { ...res, headers }
}

function wantsHtml(event: any): boolean {
  const h = normalizeHeaders(event?.headers)
  const accept = h["accept"] || ""
  return accept.includes("text/html")
}

function normalizeHeaders(h: any): Record<string, string> {
  const out: Record<string, string> = {}
  if (!h) return out
  for (const [k, v] of Object.entries(h))
    out[String(k).toLowerCase()] = String(v)
  return out
}

function deriveHttpResource(event: any): string {
  const method =
    event?.requestContext?.http?.method ||
    event?.requestContext?.httpMethod ||
    ""

  const path =
    event?.requestContext?.http?.path || event?.rawPath || event?.path || ""

  if (!method || !path) return ""

  // Build canonical-like route key without depending on old core helper symbols.
  try {
    return httpRouteResource(String(method), String(path))
  } catch {
    return ""
  }
}

function httpRouteResource(method: string, path: string): string {
  const m = method.trim().toUpperCase()
  const p = String(path)
  if (!m) throw new Error("HTTP method required")
  if (!p) throw new Error("HTTP path required")
  if (/\s/.test(p)) throw new Error(`Invalid HTTP path (contains whitespace): ${p}`)
  return `http:route:${m}:${p}`
}

// Deterministic idempotency key (backend must enforce)
function makeIdempotencyKey(
  subject: { type: string; id: string },
  resource: string,
  required: any,
  evaluatedPlan: string,
): string {
  // Keep it stable and short-ish. Backend can hash if needed.
  return `vg:${subject.type}:${subject.id}|${resource}|${required.type}|${evaluatedPlan}|${stableJson(
    required,
  )}`
}

function stableJson(obj: any): string {
  // deterministic stringify (shallow enough for GuardRequired)
  if (!obj || typeof obj !== "object") return String(obj)
  const keys = Object.keys(obj).sort()
  const out: any = {}
  for (const k of keys) out[k] = obj[k]
  return JSON.stringify(out)
}
