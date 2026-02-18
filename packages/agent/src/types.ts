export type AgentConfig = {
  base: string // https://pay.gorilla.build
  tenant_token?: string // tenant token OR site token (same header)
}

export type SubjectWire = { type: string; id: string }

export type GuardRequired =
  | {
      type: "subscription"
      plan: string
      period?: "day" | "week" | "month" | "year"
    }
  // (keep the rest of your existing union here if you use it)
  | { type: string; [k: string]: any }

export type OnchainPaymentInstruction = {
  method: "onchain"
  currency: string
  token: string
  chain_id: number
  to_address: string
  amount_raw: string
  decimals: number
  token_address: string
  is_free?: false
}

export type FreePaymentInstruction = {
  method: "free"
  currency: string
  is_free: true
  reason?: string // optional: "free_plan" | "zero_amount" etc.
}

export type CheckoutSessionResponse = {
  session_id: string
  status: string
  expires_at: string
  tenant_id: number
  product_id: number
  plan: string
  evaluated_plan: string
  amount_cents: number
  currency: string
  resource: string
  anchor_resource: string
  paymentUrl?: string
  server_time: string
  agent_proof_ttl_seconds: number
  required_hash: string
  payment: OnchainPaymentInstruction
}

export type AgentSubmitTxResponse = {
  ok: true
  session_id: string
  reference: string
  status: string
}

export type AgentPaymentProofV2 = {
  session_id: string
  tx_hash: string
  anchor_resource: string
  required_hash: string

  pricing_hash: string
  quantity_effective: number

  chain_id: number
  token_address: string
  to_address: string
  amount_raw: string
  decimals: number

  expires_at: string // ISO
}

export type SessionStatusResponse = {
  session_id: string
  status: "pending" | "paid" | "failed" | "cancelled" | "expired" | string
  paid_at?: string | null
  expires_at?: string | null
}

export type VerifySessionPendingResponse = {
  ok: false
  state: string // e.g. "pending" | "no_matching_transfer" | ...
  payment_status?: string
  session_status?: string
}

export type VerifySessionOkResponse = {
  ok: true
  state: "confirmed"
  payment: {
    reference: string
    tx_hash: string
    amount_cents: number
    currency: string
  }
  session: {
    id: string
    status: string
  }
  mandate: {
    id: number | null
    product_id: number | null
    resource: string | null
    plan: string | null
    expires_at: string | null
  }
}

export type VerifySessionResponse =
  | VerifySessionOkResponse
  | VerifySessionPendingResponse
