import type { Command } from "commander"
import { Wallet } from "ethers"
import { signAgentProof } from "@valuya/agent"

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
      const sig = await signAgentProof({
        wallet,
        sessionId: opts.sessionId,
        txHash: opts.txHash,
        resource: opts.resource,
        tenantId: opts.tenantId,
      })
      console.log(sig)
    })
}
