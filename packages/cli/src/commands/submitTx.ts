import type { Command } from "commander"
import { Wallet, JsonRpcProvider } from "ethers"
import { submitAgentTx, signAgentProof } from "@valuya/agent"

export function cmdSubmitTx(program: Command) {
  program
    .command("submit-tx")
    .requiredOption("--base <url>")
    .option("--tenanttoken <token>")
    .requiredOption("--pk <privateKey>")
    .requiredOption("--session-id <id>")
    .requiredOption("--tx-hash <hash>")
    .requiredOption("--resource <resource>")
    .requiredOption("--tenant-id <id>")
    .action(async (opts) => {
      const provider = new JsonRpcProvider(opts.rpc)
      const wallet = new Wallet(opts.pk, provider)
      const from = await wallet.getAddress()

      const signature = await signAgentProof({
        wallet,
        sessionId: opts.sessionId,
        txHash: opts.txHash,
        resource: opts.resource,
        tenantId: opts.tenantId,
      })

      const res = await submitAgentTx({
        cfg: { base: opts.base, tenanttoken: opts.tenanttoken },
        sessionId: opts.sessionId,
        tx_hash: opts.txHash,
        from_address: from.toLowerCase(),
        signature,
      })

      console.log(JSON.stringify(res, null, 2))
    })
}
