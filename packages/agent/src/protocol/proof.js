import { buildAgentPaymentProofMessageV2 } from "@valuya/core";
export async function signAgentPaymentProofV2(signer, proof) {
    const message = buildAgentPaymentProofMessageV2(proof);
    return signer.signMessage(message);
}
