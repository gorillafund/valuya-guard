import { createServer } from "node:http"

const PORT = Number(process.env.PORT || 8090)
const BASE = String(process.env.VALUYA_BASE || "").replace(/\/+$/, "")
const TOKEN = String(process.env.VALUYA_TENANT_TOKEN || process.env.VALUYA_SITE_TOKEN || "")
const DEFAULT_PLAN = String(process.env.VALUYA_PLAN || "standard")
const DEFAULT_RESOURCE = String(process.env.VALUYA_RESOURCE || "")
const WEB_REDIRECT = String(process.env.VALUYA_WEB_REDIRECT || "true") === "true"

export function createGuardHandler(env = process.env) {
  const base = String(env.VALUYA_BASE || "").replace(/\/+$/, "")
  const token = String(env.VALUYA_TENANT_TOKEN || env.VALUYA_SITE_TOKEN || "")
  const defaultPlan = String(env.VALUYA_PLAN || "standard")
  const defaultResource = String(env.VALUYA_RESOURCE || "")
  const webRedirect = String(env.VALUYA_WEB_REDIRECT || "true") === "true"

  if (!base || !token) {
    throw new Error("Missing required env: VALUYA_BASE and VALUYA_TENANT_TOKEN")
  }

  return async (req, res) => {
  if (req.url !== "/guard/check") {
    res.writeHead(404, { "content-type": "application/json" })
    res.end(JSON.stringify({ ok: false, error: "not_found" }))
    return
  }

  const method = String(req.headers["x-original-method"] || req.method || "GET").toUpperCase()
  const path = String(req.headers["x-original-path"] || "/")
  const accept = String(req.headers["accept"] || "")
  const subjectId = String(req.headers["x-valuya-subject-id"] || "anon:unknown")

  const resource = defaultResource || `http:route:${method}:${path}`
  const plan = defaultPlan

  try {
    const ent = await entitlements({ base, token, plan, resource, subjectId })
    if (ent.active === true) {
      res.writeHead(200)
      res.end()
      return
    }

    const required = ent.required || { type: "subscription", plan }
    const evaluatedPlan = ent.evaluated_plan || plan
    const checkout = await checkoutSession({ base, token, plan: evaluatedPlan, resource, subjectId, required })

    const sessionId = String(checkout.session_id || "")
    const paymentUrl = String(checkout.payment_url || "")

    if (webRedirect && accept.includes("text/html") && paymentUrl) {
      res.writeHead(302, {
        location: paymentUrl,
        "x-valuya-session-id": sessionId,
      })
      res.end()
      return
    }

    const body = {
      error: "payment_required",
      reason: ent.reason || "payment_required",
      required,
      evaluated_plan: evaluatedPlan,
      resource,
      session_id: sessionId,
      payment_url: paymentUrl,
    }

    res.writeHead(402, {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-valuya-session-id": sessionId,
      "x-valuya-payment-url": paymentUrl,
      "access-control-expose-headers": "X-Valuya-Payment-Url, X-Valuya-Session-Id",
    })
    res.end(JSON.stringify(body))
  } catch (err) {
    res.writeHead(503, { "content-type": "application/json" })
    res.end(JSON.stringify({ ok: false, error: "valuya_guard_unavailable", message: String(err instanceof Error ? err.message : err) }))
  }
  }
}

if (process.argv[1] && process.argv[1].endsWith("server.js")) {
  const handler = createGuardHandler(process.env)
  createServer(handler).listen(PORT, () => {
    console.log(`[valuya-guard-gateway] listening on :${PORT}`)
  })
}

async function entitlements(args) {
  const u = new URL(args.base + "/api/v2/entitlements")
  u.searchParams.set("plan", args.plan)
  u.searchParams.set("resource", args.resource)

  const r = await fetch(u.toString(), {
    headers: {
      accept: "application/json",
      authorization: `Bearer ${args.token}`,
      "x-valuya-subject-id": args.subjectId,
    },
  })
  const t = await r.text()
  if (!r.ok) throw new Error(`entitlements_failed:${r.status}:${t.slice(0, 300)}`)
  return t ? JSON.parse(t) : {}
}

async function checkoutSession(args) {
  const [type, ...rest] = String(args.subjectId).split(":")
  const subject = { type, id: rest.join(":") || "unknown" }
  const r = await fetch(args.base + "/api/v2/checkout/sessions", {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      authorization: `Bearer ${args.token}`,
      "x-valuya-subject-id": args.subjectId,
    },
    body: JSON.stringify({
      resource: args.resource,
      plan: args.plan,
      evaluated_plan: args.plan,
      subject,
      principal: subject,
      required: args.required,
      mode: "agent",
    }),
  })

  const t = await r.text()
  if (!r.ok) throw new Error(`checkout_failed:${r.status}:${t.slice(0, 300)}`)
  return t ? JSON.parse(t) : {}
}
