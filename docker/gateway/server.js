import { createServer } from "node:http"

const PORT = Number(process.env.PORT || 8090)

export function createGuardHandler(env = process.env) {
  const cfg = readConfig(env)

  return async (req, res) => {
    const started = Date.now()
    const requestId = requestHeader(req, "x-request-id") || randomId()

    if (req.url === "/healthz") {
      writeJson(res, 200, { ok: true, service: "valuya-guard-gateway" }, { "x-request-id": requestId })
      return
    }

    if (req.url !== "/guard/check") {
      writeJson(res, 404, { ok: false, error: "not_found" }, { "x-request-id": requestId })
      return
    }

    const method = requestHeader(req, "x-original-method") || req.method || "GET"
    const path = requestHeader(req, "x-original-path") || "/"
    const accept = requestHeader(req, "accept") || ""
    const subjectId = (requestHeader(req, "x-valuya-subject-id") || "").trim()

    if (!subjectId || !subjectId.includes(":")) {
      logJson("warn", "subject_required", { request_id: requestId, method, path })
      writeJson(res, 503, {
        ok: false,
        error: "subject_required",
        message: "Missing or invalid X-Valuya-Subject-Id",
      }, { "x-request-id": requestId })
      return
    }

    const resource = resolveResource(cfg.resourceRules, cfg.defaultResource, method, path)
    const plan = cfg.defaultPlan

    try {
      const ent = await entitlements({ cfg, plan, resource, subjectId, requestId })
      if (ent.active === true) {
        logJson("info", "allow", { request_id: requestId, resource, plan, subject_id: subjectId, latency_ms: Date.now() - started })
        res.writeHead(200, { "x-request-id": requestId })
        res.end()
        return
      }

      const required = ent.required || { type: "subscription", plan }
      const evaluatedPlan = ent.evaluated_plan || plan
      const checkout = await checkoutSession({ cfg, plan: evaluatedPlan, resource, subjectId, required, requestId })

      const sessionId = String(checkout.session_id || "")
      const paymentUrl = String(checkout.payment_url || "")

      if (cfg.webRedirect && accept.includes("text/html") && paymentUrl) {
        logJson("info", "deny_redirect", { request_id: requestId, resource, plan: evaluatedPlan, subject_id: subjectId, session_id: sessionId, latency_ms: Date.now() - started })
        res.writeHead(302, {
          location: paymentUrl,
          "x-valuya-session-id": sessionId,
          "x-request-id": requestId,
        })
        res.end()
        return
      }

      logJson("info", "deny_402", { request_id: requestId, resource, plan: evaluatedPlan, subject_id: subjectId, session_id: sessionId, latency_ms: Date.now() - started })
      writeJson(
        res,
        402,
        {
          error: "payment_required",
          reason: ent.reason || "payment_required",
          required,
          evaluated_plan: evaluatedPlan,
          resource,
          session_id: sessionId,
          payment_url: paymentUrl,
        },
        {
          "cache-control": "no-store",
          "x-valuya-session-id": sessionId,
          "x-valuya-payment-url": paymentUrl,
          "access-control-expose-headers": "X-Valuya-Payment-Url, X-Valuya-Session-Id",
          "x-request-id": requestId,
        },
      )
    } catch (err) {
      logJson("error", "guard_backend_unavailable", {
        request_id: requestId,
        resource,
        plan,
        subject_id: subjectId,
        error: String(err instanceof Error ? err.message : err),
        latency_ms: Date.now() - started,
      })
      writeJson(
        res,
        cfg.failClosedStatus,
        {
          ok: false,
          error: "valuya_guard_unavailable",
          message: "Payment authorization backend unavailable",
        },
        { "x-request-id": requestId },
      )
    }
  }
}

if (process.argv[1] && process.argv[1].endsWith("server.js")) {
  const handler = createGuardHandler(process.env)
  createServer(handler).listen(PORT, () => {
    logJson("info", "gateway_listening", { port: PORT })
  })
}

function readConfig(env) {
  const base = String(env.VALUYA_BASE || "").replace(/\/+$/, "")
  const token = String(env.VALUYA_TENANT_TOKEN || env.VALUYA_SITE_TOKEN || "")
  const defaultPlan = String(env.VALUYA_PLAN || "standard")
  const defaultResource = String(env.VALUYA_RESOURCE || "")
  const webRedirect = String(env.VALUYA_WEB_REDIRECT || "true") === "true"
  const timeoutMs = Math.max(1, Number(env.VALUYA_TIMEOUT_MS || 8000))
  const retryMaxAttempts = Math.max(1, Number(env.VALUYA_RETRY_MAX_ATTEMPTS || 2))
  const retryBackoffMs = parseBackoff(env.VALUYA_RETRY_BACKOFF_MS || "300,1200")
  const failClosedStatus = Math.max(500, Number(env.VALUYA_FAIL_CLOSED_STATUS || 503))
  const resourceRules = parseResourceRules(env.VALUYA_RESOURCE_RULES || "")

  if (!base || !token) {
    throw new Error("Missing required env: VALUYA_BASE and VALUYA_TENANT_TOKEN")
  }

  return {
    base,
    token,
    defaultPlan,
    defaultResource,
    webRedirect,
    timeoutMs,
    retryMaxAttempts,
    retryBackoffMs,
    failClosedStatus,
    resourceRules,
  }
}

function resolveResource(rules, defaultResource, method, path) {
  const m = String(method || "GET").toUpperCase()
  const p = String(path || "/")
  for (const r of rules) {
    if (r.method && r.method !== m) continue
    if (!r.path_prefix || p.startsWith(r.path_prefix)) return r.resource
  }
  return defaultResource || `http:route:${m}:${p}`
}

function parseResourceRules(raw) {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed
      .map((x) => ({
        method: x.method ? String(x.method).toUpperCase() : undefined,
        path_prefix: String(x.path_prefix || ""),
        resource: String(x.resource || ""),
      }))
      .filter((x) => x.path_prefix && x.resource)
  } catch {
    return []
  }
}

function parseBackoff(raw) {
  return String(raw)
    .split(",")
    .map((x) => Number(x.trim()))
    .filter((x) => Number.isFinite(x) && x >= 0)
}

async function entitlements(args) {
  const u = new URL(args.cfg.base + "/api/v2/entitlements")
  u.searchParams.set("plan", args.plan)
  u.searchParams.set("resource", args.resource)

  const t = await fetchWithRetry(args.cfg, u.toString(), {
    headers: {
      accept: "application/json",
      authorization: `Bearer ${args.cfg.token}`,
      "x-valuya-subject-id": args.subjectId,
      "x-request-id": args.requestId,
    },
  })

  return t ? JSON.parse(t) : {}
}

async function checkoutSession(args) {
  const [type, ...rest] = String(args.subjectId).split(":")
  const subject = { type, id: rest.join(":") || "unknown" }

  const t = await fetchWithRetry(args.cfg, args.cfg.base + "/api/v2/checkout/sessions", {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      authorization: `Bearer ${args.cfg.token}`,
      "x-valuya-subject-id": args.subjectId,
      "x-request-id": args.requestId,
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

  return t ? JSON.parse(t) : {}
}

async function fetchWithRetry(cfg, url, init) {
  let lastErr = null
  const attempts = cfg.retryMaxAttempts
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const res = await timedFetch(url, init, cfg.timeoutMs)
      const text = await res.text()
      if (!res.ok) {
        if (attempt < attempts && retryableStatus(res.status)) {
          await sleep(cfg.retryBackoffMs[Math.min(attempt - 1, cfg.retryBackoffMs.length - 1)] || 0)
          continue
        }
        throw new Error(`upstream_http_${res.status}:${text.slice(0, 300)}`)
      }
      return text
    } catch (err) {
      lastErr = err
      if (attempt < attempts) {
        await sleep(cfg.retryBackoffMs[Math.min(attempt - 1, cfg.retryBackoffMs.length - 1)] || 0)
        continue
      }
    }
  }
  throw lastErr || new Error("upstream_failed")
}

function retryableStatus(status) {
  return status === 408 || status === 425 || status === 429 || (status >= 500 && status <= 599)
}

async function timedFetch(url, init, timeoutMs) {
  const controller = new AbortController()
  const id = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(url, { ...init, signal: controller.signal })
  } finally {
    clearTimeout(id)
  }
}

function requestHeader(req, key) {
  return req.headers?.[key] || req.headers?.[key.toLowerCase()] || ""
}

function writeJson(res, status, body, headers = {}) {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    ...headers,
  })
  res.end(JSON.stringify(body))
}

function logJson(level, event, fields = {}) {
  const out = {
    ts: new Date().toISOString(),
    level,
    event,
    ...fields,
  }
  if (level === "error") console.error(JSON.stringify(out))
  else console.log(JSON.stringify(out))
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)))
}

function randomId() {
  return Math.random().toString(36).slice(2, 10)
}
