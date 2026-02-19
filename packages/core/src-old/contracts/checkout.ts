import type { PaymentInstruction } from "../types.js"
import type { CanonicalResource } from "../resource.js"

export type CheckoutSessionResponse = {
  payment_url: string
  session_id: string
  expires_at?: string
}

// ✅ NEW: used by Agent CLI
export type AgentCheckoutSessionResponse = CheckoutSessionResponse & {
  // canonical keys that must match backend submitTx() checks
  anchor_resource: CanonicalResource
  required_hash: string

  pricing_hash: string
  quantity_effective: number

  // payment hint (onchain)
  payment: PaymentInstruction

  // needed to compute proof ttl
  server_time: string
  agent_proof_ttl_seconds: number
}
