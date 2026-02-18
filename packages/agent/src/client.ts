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
  if (cfg.tenant_token) h.Authorization = `Bearer ${cfg.tenant_token}`
  return h
}

export async function createCheckoutSession(args: {
  cfg: AgentConfig
  plan: string
  evaluated_plan?: string
  resource: string
  subject: SubjectWire | string
  required?: any
  principal?: { type: string; id: string }
  anchor_resource?: string
  success_url?: string
  cancel_url?: string
  idempotencyKey?: string
  product_id?: number
  payment_currency?: string
  currency?: string
  amount_cents?: number
  meta?: Record<string, any>
}): Promise<CheckoutSessionResponse> {
  const base = normalizeBase(args.cfg.base)
  const url = base + "/api/v2/checkout/sessions"

  const h = headers(args.cfg)
  if (args.idempotencyKey) h["Idempotency-Key"] = args.idempotencyKey

  // Build body ONLY with fields your backend expects
  const body: any = {
    product_id: args.product_id,
    plan: args.plan,
    evaluated_plan: args.evaluated_plan ?? args.plan,
    resource: args.resource,
    subject: args.subject,
    required: args.required,
    success_url: args.success_url ?? "",
    cancel_url: args.cancel_url ?? "",
    idempotency_key: args.idempotencyKey ?? "",
  }

  if (args.principal) body.principal = args.principal
  if (args.anchor_resource) body.anchor_resource = args.anchor_resource
  if (args.required) body.required = args.required
  if (args.product_id) body.product_id = args.product_id

  if (args.payment_currency) {
    body.payment = { currency: args.payment_currency }
  }

  if (args.success_url) body.success_url = args.success_url
  if (args.cancel_url) body.cancel_url = args.cancel_url
  if (args.idempotencyKey) body.idempotency_key = args.idempotencyKey
  if (args.meta) body.meta = args.meta

  const resp = await fetch(url, {
    method: "POST",
    headers: h,
    body: JSON.stringify(body),
  })

  const txt = await resp.text()
  if (!resp.ok) {
    throw new Error(
      `createCheckoutSession_failed:${resp.status}:${txt.slice(0, 300)}`,
    )
  }

  return JSON.parse(txt)
}

export async function submitAgentTx(args: {
  cfg: AgentConfig
  sessionId: string
  tx_hash: string
  wallet_address: string
  signature: string
  proof: any
}): Promise<AgentSubmitTxResponse> {
  const base = normalizeBase(args.cfg.base)
  const url =
    base + `/api/v2/agent/sessions/${encodeURIComponent(args.sessionId)}/tx`

  const resp = await fetch(url, {
    method: "POST",
    headers: headers(args.cfg),
    body: JSON.stringify({
      tx_hash: args.tx_hash,
      wallet_address: args.wallet_address,
      signature: args.signature,
      proof: args.proof,
    }),
  })

  const txt = await resp.text()
  if (!resp.ok)
    throw new Error(`submitAgentTx_failed:${resp.status}:${txt.slice(0, 300)}`)
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
