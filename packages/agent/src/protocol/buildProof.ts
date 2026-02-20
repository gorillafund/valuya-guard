// packages/agent/src/protocol/buildProof.ts
import type { AgentCheckoutSessionResponseV2 } from "@valuya/core"
import type { AgentPaymentProofV2 } from "@valuya/core" // adjust path to where your type lives

export function buildAgentPaymentProofFromSession(args: {
  session: AgentCheckoutSessionResponseV2
  tx_hash: string
  expires_at: string
}): AgentPaymentProofV2 {
  const { session, tx_hash, expires_at } = args

  if (!session.anchor_resource)
    throw new Error("session_missing_anchor_resource")
  if (!session.required_hash) throw new Error("session_missing_required_hash")
  if (!session.pricing_hash) throw new Error("session_missing_pricing_hash")
  if (typeof session.quantity_effective !== "number")
    throw new Error("session_missing_quantity_effective")

  const payment = session.payment
  if (!payment) throw new Error("session_missing_payment")
  if (payment.method !== "onchain") {
    throw new Error(`session_payment_not_onchain:${payment.method}`)
  }

  const token_address = (payment.token_address ?? "").toLowerCase()
  if (!token_address) throw new Error("payment_missing_token_address")

  return {
    session_id: session.session_id,
    tx_hash: tx_hash.toLowerCase(),
    anchor_resource: session.anchor_resource,
    required_hash: session.required_hash,

    // pricing binding
    pricing_hash: session.pricing_hash,
    quantity_effective: session.quantity_effective,

    // routing binding
    chain_id: payment.chain_id,
    token_address,
    to_address: payment.to_address.toLowerCase(),
    amount_raw: payment.amount_raw,
    decimals: payment.decimals,

    expires_at,
  }
}
