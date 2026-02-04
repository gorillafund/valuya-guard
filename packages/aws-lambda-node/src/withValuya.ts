import type { GuardRequired } from "@valuya/core"
import { paymentRequiredResponse, httpRouteResource } from "@valuya/core"
import { defaultSubject } from "./subjectResolver.js"
import { fetchEntitlements, createCheckoutSession } from "./guardClient.js"
import type { LambdaHandler, WithValuyaOptions } from "./types.js"

export function withValuya(
  opts: WithValuyaOptions,
  handler: LambdaHandler,
): LambdaHandler {
  const valuyaBase = opts.valuyaBase || process.env.VALUYA_BASE || ""
  const tenanttoken = opts.tenanttoken || process.env.VALUYA_SITE_TOKEN || ""

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
      cfg: { base: valuyaBase, tenanttoken: tenanttoken || undefined },
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
      cfg: { base: valuyaBase, tenanttoken: tenanttoken || undefined },
      plan: evaluatedPlan,
      resource,
      subject: subjectWire,
      required,
      successUrl: opts.successUrl,
      cancelUrl: opts.cancelUrl,
      idempotencyKey,
    })

    // RFC: HTML → redirect (still after checkout session creation)

    if (wantsHtml(event)) {
      return {
        statusCode: 302,
        headers: {
          "Cache-Control": "no-store",
          Location: session.payment_url,

          // Optional, useful for clients:
          "X-Valuya-Payment-Url": session.payment_url,
          "X-Valuya-Session-Id": session.session_id,
        },
        body: "",
      }
    }

    // RFC: API/agents → 402 JSON built centrally by core
    const resp = paymentRequiredResponse({
      reason: (ent as any)?.reason || "subscription_inactive",
      required,
      evaluatedPlan,
      resource: resource as any, // resource is canonical string by construction in core helper
      paymentUrl: session.payment_url,
      sessionId: session.session_id,
      payment: (session as any).payment, // optional payment hint
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

  // core helper preserves trailing slash and builds http:route:METHOD:/path
  try {
    return httpRouteResource(String(method), String(path))
  } catch {
    return ""
  }
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
