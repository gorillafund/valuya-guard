import type { Signer } from "ethers"
import type { AgentProof } from "./types.js"

export function buildAgentProofMessage(p: AgentProof): string {
  // IMPORTANT: exact field order, exact labels, exact newlines.
  return [
    "Valuya Guard Agent Payment Proof v2",
    `session_id: ${p.session_id}`,
    `tx_hash: ${p.tx_hash.toLowerCase()}`,
    `resource: ${p.resource}`,
    `required_hash: ${p.required_hash}`,
    `chain_id: ${p.chain_id}`,
    `token_address: ${p.token_address.toLowerCase()}`,
    `to_address: ${p.to_address.toLowerCase()}`,
    `amount_raw: ${p.amount_raw}`,
    `expires_at: ${p.expires_at}`,
  ].join("\n")
}

export async function signAgentProof(args: {
  wallet: Signer
  proof: AgentProof
}): Promise<string> {
  const msg = buildAgentProofMessage(args.proof)
  return args.wallet.signMessage(msg)
}
