import type { AgentPaymentProofV2 } from "../protocol/agentPayment.js"

export const AGENT_PAYMENT_PROOF_V2_HEADER =
  "Valuya Guard Agent Payment Proof v2"

export function buildAgentPaymentProofMessageV2(
  p: AgentPaymentProofV2,
): string {
  return [
    AGENT_PAYMENT_PROOF_V2_HEADER,
    `session_id: ${p.session_id}`,
    `tx_hash: ${String(p.tx_hash).toLowerCase()}`,
    `anchor_resource: ${p.anchor_resource}`,
    `required_hash: ${p.required_hash}`,
    `pricing_hash: ${p.pricing_hash}`,
    `quantity_effective: ${p.quantity_effective}`,
    `chain_id: ${p.chain_id}`,
    `token_address: ${String(p.token_address).toLowerCase()}`,
    `to_address: ${String(p.to_address).toLowerCase()}`,
    `amount_raw: ${p.amount_raw}`,
    `decimals: ${p.decimals}`,
    `expires_at: ${p.expires_at}`,
  ].join("\n")
}
