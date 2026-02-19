// packages/core/src/contracts/agent_payment_proof.ts

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
  expires_at: string
}

export function buildAgentPaymentProofMessageV2(
  p: AgentPaymentProofV2,
): string {
  return [
    "Valuya Guard Agent Payment Proof v2",
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
