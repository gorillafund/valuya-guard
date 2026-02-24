export type InvokeHttpMethod = "POST" | "GET" | "PUT" | "PATCH" | "DELETE"

export type InvokeRetryPolicy = {
  max_attempts: number
  backoff_ms: number[]
}

export type InvokeV1Spec = {
  version: "1"
  method: InvokeHttpMethod
  url: string
  headers?: Record<string, string>
  body?: unknown
  timeout_ms?: number
  retry_policy?: InvokeRetryPolicy
}

export type InvokeExecutionResult = {
  status: number
  body: unknown
  latency_ms: number
  retry_count: number
}

const TRANSIENT_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504])

function parseJsonOrText(txt: string): unknown {
  try {
    return JSON.parse(txt)
  } catch {
    return txt
  }
}

function isTransientStatus(status: number): boolean {
  return TRANSIENT_STATUSES.has(status)
}

function isNetworkLikeError(err: unknown): boolean {
  if (!(err instanceof Error)) return false
  const msg = String(err.message || "")
  return (
    msg.includes("fetch failed") ||
    msg.includes("network") ||
    msg.includes("aborted") ||
    msg.includes("timed out")
  )
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export function normalizeInvokeV1(input: any): InvokeV1Spec | null {
  if (!input || typeof input !== "object") return null
  if (String(input.version) !== "1") return null
  const method = String(input.method || "").toUpperCase()
  const allowed = new Set(["POST", "GET", "PUT", "PATCH", "DELETE"])
  if (!allowed.has(method)) return null
  const url = String(input.url || "").trim()
  if (!url) return null
  const out: InvokeV1Spec = {
    version: "1",
    method: method as InvokeHttpMethod,
    url,
  }
  if (input.headers && typeof input.headers === "object") {
    out.headers = input.headers as Record<string, string>
  }
  if ("body" in input) out.body = input.body
  if (typeof input.timeout_ms === "number") out.timeout_ms = input.timeout_ms
  if (input.retry_policy && typeof input.retry_policy === "object") {
    out.retry_policy = {
      max_attempts: Number(input.retry_policy.max_attempts ?? 1),
      backoff_ms: Array.isArray(input.retry_policy.backoff_ms)
        ? input.retry_policy.backoff_ms.map((x: any) => Number(x))
        : [],
    }
  }
  return out
}

export async function executeInvokeV1(args: {
  invoke: InvokeV1Spec
  fetchImpl?: typeof fetch
}): Promise<InvokeExecutionResult> {
  const fetchImpl = args.fetchImpl ?? fetch
  const invoke = args.invoke
  const timeoutMs = Math.max(1, Number(invoke.timeout_ms ?? 15000))
  const maxAttempts = Math.max(1, Number(invoke.retry_policy?.max_attempts ?? 1))
  const backoff = invoke.retry_policy?.backoff_ms ?? []

  let attempt = 0
  while (attempt < maxAttempts) {
    const start = Date.now()
    const controller = new AbortController()
    const t = setTimeout(() => controller.abort(), timeoutMs)
    try {
      attempt++
      const headers: Record<string, string> = { ...(invoke.headers ?? {}) }
      const body =
        invoke.body === undefined
          ? undefined
          : typeof invoke.body === "string"
            ? invoke.body
            : JSON.stringify(invoke.body)

      if (body !== undefined && !headers["content-type"] && !headers["Content-Type"]) {
        headers["Content-Type"] = "application/json"
      }

      const resp = await fetchImpl(invoke.url, {
        method: invoke.method,
        headers,
        body,
        signal: controller.signal,
      })
      const txt = await resp.text()
      const parsed = parseJsonOrText(txt)
      const latency = Date.now() - start
      if (resp.ok) {
        return {
          status: resp.status,
          body: parsed,
          latency_ms: latency,
          retry_count: attempt - 1,
        }
      }

      if (attempt < maxAttempts && isTransientStatus(resp.status)) {
        const wait = Math.max(0, Number(backoff[attempt - 1] ?? 0))
        if (wait > 0) await sleep(wait)
        continue
      }

      throw new Error(
        `invoke_http_error:${resp.status}:${typeof parsed === "string" ? parsed.slice(0, 500) : JSON.stringify(parsed).slice(0, 500)}`,
      )
    } catch (err) {
      const isAbort = err instanceof Error && err.name === "AbortError"
      const retryable = isAbort || isNetworkLikeError(err)
      if (attempt < maxAttempts && retryable) {
        const wait = Math.max(0, Number(backoff[attempt - 1] ?? 0))
        if (wait > 0) await sleep(wait)
        continue
      }
      throw err
    } finally {
      clearTimeout(t)
    }
  }

  throw new Error("invoke_failed_unexpectedly")
}

export function resolveAccessPlan(args: {
  invoke?: unknown
  visitUrl?: string | null
  overrideUrl?: string
}): { kind: "invoke"; invoke: InvokeV1Spec } | { kind: "visit"; url: string } | { kind: "none" } {
  const inv = normalizeInvokeV1(args.invoke)
  if (inv) return { kind: "invoke", invoke: inv }

  const url = (args.overrideUrl ?? args.visitUrl ?? "").trim()
  if (url) return { kind: "visit", url }
  return { kind: "none" }
}

