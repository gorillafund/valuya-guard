export type AgentConfig = {
  base: string // https://pay.gorilla.build
  tenanttoken?: string // tenant token OR site token (same header)
}

export type SubjectWire = { type: string; id: string }

export type GuardRequired = any // keep loose; your backend is authoritative

export type CheckoutSessionResponse = {
  session_id: string
  payment_url: string
  expires_at?: string
  resource: string
  evaluated_plan?: string
  required?: any
  payment?: any
}

export type AgentSubmitTxResponse = {
  ok: true
  session_id: string
  reference: string
  status: string
  status_url: string
}

export type SessionStatusResponse = {
  session_id: string
  status: "pending" | "paid" | "failed" | "cancelled" | "expired" | string
  paid_at?: string | null
  expires_at?: string | null
}
