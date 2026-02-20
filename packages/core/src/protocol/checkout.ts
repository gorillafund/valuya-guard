import type { AnchorResourceKey } from "../canon/resource.js"
import type { PaymentInstruction } from "./payment.js"

export type CheckoutSessionResponse = {
  payment_url: string
  session_id: string
  expires_at?: string
}

export type AgentCheckoutSessionResponseV2 = CheckoutSessionResponse & {
  anchor_resource: AnchorResourceKey
  required_hash: string

  pricing_hash: string
  quantity_effective: number

  payment: PaymentInstruction

  server_time: string
  agent_proof_ttl_seconds: number
}
