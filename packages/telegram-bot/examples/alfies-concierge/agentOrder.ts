import type { OrderPayload } from "./orderBackend.js"

export type CreateAgentOrderArgs = {
  baseUrl: string
  tenantToken: string
  subjectHeader: string
  localOrderIdCandidate: string
  orderPayload: OrderPayload
  logger?: (event: string, fields: Record<string, unknown>) => void
  fetchImpl?: typeof fetch
}

export async function createAgentOrderForDelegatedPayment(
  args: CreateAgentOrderArgs,
): Promise<{ merchantOrderId: string; response: unknown }> {
  const fetchImpl = args.fetchImpl || fetch
  const logger = args.logger || (() => {})
  const endpoint = `${args.baseUrl.replace(/\/+$/, "")}/api/agent/orders`

  logger("agent_order_create_request", {
    tenant: tokenPreview(args.tenantToken),
    local_order_id_candidate: args.localOrderIdCandidate,
    order_id_sent: args.orderPayload.order_id,
    subjectHeader: args.subjectHeader,
    resource: args.orderPayload.resource,
    plan: args.orderPayload.plan,
    endpoint,
  })

  const response = await fetchImpl(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${args.tenantToken}`,
      "Content-Type": "application/json",
      Accept: "application/json",
      "X-Valuya-Subject": args.subjectHeader,
      "X-Valuya-Subject-Id": args.subjectHeader,
      "Idempotency-Key": `order-email:${args.orderPayload.order_id}`,
    },
    body: JSON.stringify(args.orderPayload),
  })

  const body = await safeParseJson(response)
  const merchantOrderId = extractMerchantOrderId(body)

  logger("agent_order_create_response", {
    tenant: tokenPreview(args.tenantToken),
    local_order_id_candidate: args.localOrderIdCandidate,
    order_id_sent: args.orderPayload.order_id,
    returned_server_order_id: merchantOrderId || null,
    status: response.status,
    ok: response.ok,
  })

  if (!response.ok) {
    const err = new Error(`agent_order_create_failed:${response.status}:${JSON.stringify(body).slice(0, 300)}`)
    ;(err as any).status = response.status
    ;(err as any).body = body
    ;(err as any).code = readString(readRecord(body)?.error) || `http_${response.status}`
    throw err
  }

  if (!merchantOrderId) {
    throw new Error("agent_order_id_missing_fail_safe")
  }

  return {
    merchantOrderId,
    response: body,
  }
}

export function extractMerchantOrderId(body: unknown): string | null {
  const root = readRecord(body)
  const candidates: unknown[] = [
    root?.order_id,
    readRecord(root?.order)?.order_id,
    readRecord(root?.order)?.id,
    root?.id,
  ]
  for (const c of candidates) {
    if (typeof c === "string" && c.trim()) return c.trim()
    if (typeof c === "number" && Number.isFinite(c)) return String(c)
  }
  return null
}

async function safeParseJson(response: Response): Promise<unknown> {
  const text = await response.text()
  if (!text) return {}
  try {
    return JSON.parse(text)
  } catch {
    return { raw: text }
  }
}

function tokenPreview(token: string): string {
  const t = String(token || "").trim()
  return t ? t.slice(0, 12) : "unknown"
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null
}

function readString(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim()) return value.trim()
  return undefined
}
