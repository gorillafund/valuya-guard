import type { AccessInvokeV1 } from "@valuya/agent"
import type { InvokeExecutionOptions, RetryPolicyNormalized, NormalizedInvokeResult } from "./types.js"

export async function executeInvokeV1(opts: InvokeExecutionOptions): Promise<NormalizedInvokeResult> {
  const invoke = opts.invoke
  if (!invoke) return { attempted: false }

  if (invoke.version !== "1") {
    return { attempted: true, error: `unsupported_invoke_version:${String((invoke as any)?.version || "unknown")}` }
  }

  const body = chooseBody(invoke)
  if ((invoke.method === "POST" || invoke.method === "PUT" || invoke.method === "PATCH") && body === undefined) {
    return { attempted: true, error: "invoke_body_missing" }
  }

  const retry = normalizeRetry(invoke)
  const timeoutMs = typeof invoke.timeout_ms === "number" && invoke.timeout_ms > 0 ? invoke.timeout_ms : 15000

  const started = Date.now()
  let lastError: unknown = null

  for (let attempt = 1; attempt <= retry.maxAttempts; attempt++) {
    try {
      const response = await timedFetch({
        method: invoke.method,
        url: invoke.url,
        headers: {
          ...(invoke.headers || {}),
          ...(opts.allowedRuntimeHeaders || {}),
        },
        body,
        timeoutMs,
      })

      const text = await response.text()
      const parsed = safeJson(text)

      if (response.ok) {
        return {
          attempted: true,
          status: response.status,
          body: parsed ?? text,
          latency_ms: Date.now() - started,
          retry_count: attempt - 1,
        }
      }

      if (attempt < retry.maxAttempts && shouldRetry(response.status)) {
        await sleep(retry.backoffMs[Math.min(attempt - 1, retry.backoffMs.length - 1)] || 0)
        continue
      }

      return {
        attempted: true,
        status: response.status,
        body: parsed ?? text,
        latency_ms: Date.now() - started,
        retry_count: attempt - 1,
        error: `invoke_http_${response.status}`,
      }
    } catch (err) {
      lastError = err
      if (attempt < retry.maxAttempts) {
        await sleep(retry.backoffMs[Math.min(attempt - 1, retry.backoffMs.length - 1)] || 0)
        continue
      }
    }
  }

  return {
    attempted: true,
    latency_ms: Date.now() - started,
    retry_count: retry.maxAttempts - 1,
    error: normalizeError(lastError),
  }
}

function chooseBody(invoke: AccessInvokeV1): unknown | undefined {
  if (invoke.body !== undefined && invoke.body !== null) return invoke.body
  if (invoke.body_template !== undefined && invoke.body_template !== null) return invoke.body_template
  return undefined
}

function normalizeRetry(invoke: AccessInvokeV1): RetryPolicyNormalized {
  const rp = invoke.retry_policy
  const maxAttempts = Math.max(1, Number(rp?.max_attempts || 1))

  const rawBackoff = rp?.backoff_ms
  let backoffMs: number[]
  if (Array.isArray(rawBackoff)) {
    backoffMs = rawBackoff.map((n) => Math.max(0, Number(n || 0)))
  } else if (typeof rawBackoff === "number") {
    backoffMs = [Math.max(0, rawBackoff)]
  } else {
    backoffMs = [0]
  }

  if (backoffMs.length === 0) backoffMs = [0]
  return { maxAttempts, backoffMs }
}

function shouldRetry(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || (status >= 500 && status <= 599)
}

async function timedFetch(args: {
  method: string
  url: string
  headers: Record<string, string>
  body: unknown
  timeoutMs: number
}) {
  const controller = new AbortController()
  const id = setTimeout(() => controller.abort(), args.timeoutMs)
  try {
    return await fetch(args.url, {
      method: args.method,
      headers: args.headers,
      signal: controller.signal,
      body:
        args.method === "GET" || args.method === "DELETE"
          ? undefined
          : args.body !== undefined
            ? JSON.stringify(args.body)
            : undefined,
    })
  } finally {
    clearTimeout(id)
  }
}

function safeJson(text: string): unknown | null {
  if (!text) return null
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

function normalizeError(err: unknown): string {
  if (err instanceof Error) return err.message
  return String(err || "invoke_failed")
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)))
}
