import type { Command } from "commander"
import { Wallet } from "ethers"
import { signAgentProof } from "@valuya/agent"
import { AgentProof } from "@valuya/agent"

export function cmdSignProof(program: Command) {
  program
    .command("sign-proof")
    .requiredOption("--pk <privateKey>")
    .requiredOption("--session-id <id>")
    .requiredOption("--tx-hash <hash>")
    .requiredOption("--resource <resource>")
    .requiredOption("--tenant-id <id>")
    .action(async (opts) => {
      const wallet = new Wallet(opts.pk)
      const proof: AgentProof = {
        session_id: opts.sessionId,
        tx_hash: opts.txHash.toLowerCase(),
        resource: opts.resource,
        required_hash: opts.requiredHash,
        chain_id: Number(opts.chainId),
        token_address: opts.tokenAddress.toLowerCase(),
        to_address: opts.toAddress.toLowerCase(),
        amount_raw: opts.amountRaw,
        expires_at: opts.expiresAt,
      }
      const sig = await signAgentProof({ wallet, proof })
    })
}
