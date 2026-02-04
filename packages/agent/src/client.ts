import type {
  AgentConfig,
  SubjectWire,
  CheckoutSessionResponse,
  AgentSubmitTxResponse,
  SessionStatusResponse,
} from "./types.js"

function normalizeBase(base: string): string {
  return (base || "").trim().replace(/\/+$/, "")
}

function headers(cfg: AgentConfig): Record<string, string> {
  const h: Record<string, string> = {
    Accept: "application/json",
    "Content-Type": "application/json",
  }
  if (cfg.tenanttoken) h.Authorization = `Bearer ${cfg.tenanttoken}`
  return h
}

export async function createCheckoutSession(args: {
  cfg: AgentConfig
  plan: string
  evaluated_plan?: string
  resource: string
  subject: SubjectWire
  required: any
  success_url?: string
  cancel_url?: string
  idempotencyKey?: string
  tenant_id?: number
  product_id?: number
}): Promise<CheckoutSessionResponse> {
  const base = normalizeBase(args.cfg.base)
  const url = base + "/api/v2/checkout/sessions"

  const h = headers(args.cfg)
  if (args.idempotencyKey) h["Idempotency-Key"] = args.idempotencyKey

  const resp = await fetch(url, {
    method: "POST",
    headers: h,
    body: JSON.stringify({
      tenant_id: args.tenant_id,
      product_id: args.product_id,
      plan: args.plan,
      evaluated_plan: args.evaluated_plan ?? args.plan,
      resource: args.resource,
      subject: args.subject,
      required: args.required,
      success_url: args.success_url ?? "",
      cancel_url: args.cancel_url ?? "",
      idempotency_key: args.idempotencyKey ?? "",
    }),
  })

  const txt = await resp.text()
  if (!resp.ok)
    throw new Error(
      `createCheckoutSession_failed:${resp.status}:${txt.slice(0, 200)}`,
    )
  return JSON.parse(txt)
}

export async function submitAgentTx(args: {
  cfg: AgentConfig
  sessionId: string
  tx_hash: string
  from_address: string
  signature: string
}): Promise<AgentSubmitTxResponse> {
  const base = normalizeBase(args.cfg.base)
  const url =
    base + `/api/v2/agent/sessions/${encodeURIComponent(args.sessionId)}/tx`

  const resp = await fetch(url, {
    method: "POST",
    headers: headers(args.cfg),
    body: JSON.stringify({
      tx_hash: args.tx_hash,
      from_address: args.from_address,
      signature: args.signature,
    }),
  })

  const txt = await resp.text()
  if (!resp.ok)
    throw new Error(`submitAgentTx_failed:${resp.status}:${txt.slice(0, 200)}`)
  return JSON.parse(txt)
}

export async function getSessionStatus(args: {
  cfg: AgentConfig
  sessionId: string
}): Promise<SessionStatusResponse> {
  const base = normalizeBase(args.cfg.base)
  const url =
    base + `/api/v2/checkout/sessions/${encodeURIComponent(args.sessionId)}`

  const resp = await fetch(url, {
    method: "GET",
    headers: headers(args.cfg),
  })
  const txt = await resp.text()
  if (!resp.ok)
    throw new Error(
      `getSessionStatus_failed:${resp.status}:${txt.slice(0, 200)}`,
    )
  return JSON.parse(txt)
}
