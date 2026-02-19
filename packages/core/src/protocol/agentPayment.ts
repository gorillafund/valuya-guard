import type { AnchorResourceKey } from "../canon/resource.js"

export type AgentPaymentProofV2 = {
  session_id: string
  tx_hash: string

  anchor_resource: AnchorResourceKey
  required_hash: string

  pricing_hash: string
  quantity_effective: number

  chain_id: number
  token_address: string
  to_address: string
  amount_raw: string
  decimals: number

  expires_at: string
}

export type AgentSubmitTxResponseV2 = {
  ok: true
  session_id: string
  reference: string
  status: "pending" | "paid" | string
}

export type AgentVerifySessionResponseV2 =
  | {
      ok: true
      state: "confirmed" | "free_confirmed"
      session: any
      payment: any
      mandate: any
    }
  | {
      ok: false
      state: "pending" | "failed" | string
      payment_status?: string
      session_status?: string
    }
