import type { EvmSigner } from "../utils/evm.js"
import type { AgentPaymentProofV2 } from "@valuya/core"
import { buildAgentPaymentProofMessageV2 } from "@valuya/core"

export async function signAgentPaymentProofV2(
  signer: EvmSigner,
  proof: AgentPaymentProofV2,
): Promise<string> {
  const message = buildAgentPaymentProofMessageV2(proof)
  return signer.signMessage(message)
}
