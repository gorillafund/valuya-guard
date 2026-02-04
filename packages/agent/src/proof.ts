import type { Signer } from "ethers"

export function buildAgentProofMessage(args: {
  wallet: Signer
  sessionId: string
  txHash: string
  resource: string
  tenantId: number | string
}): string {
  const tx = (args.txHash || "").trim().toLowerCase()
  return (
    "Valuya Guard Agent Payment Proof v1\n" +
    `session_id=${args.sessionId}\n` +
    `tx_hash=${tx}\n` +
    `resource=${args.resource}\n` +
    `tenant_id=${args.tenantId}`
  )
}

export async function signAgentProof(args: {
  wallet: Signer
  sessionId: string
  txHash: string
  resource: string
  tenantId: number | string
}): Promise<string> {
  const msg = buildAgentProofMessage(args)
  return args.wallet.signMessage(msg)
}
