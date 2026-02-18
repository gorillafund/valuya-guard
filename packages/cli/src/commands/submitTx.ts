import type { Command } from "commander"
import { Wallet, JsonRpcProvider } from "ethers"
import { submitAgentTx, signAgentProof, AgentProof } from "@valuya/agent"

export function cmdSubmitTx(program: Command) {
  program
    .command("submit-tx")
    .requiredOption("--base <url>")
    .option("--tenant_token <token>")
    .requiredOption("--pk <privateKey>")
    .requiredOption("--session-id <id>")
    .requiredOption("--tx-hash <hash>")
    .requiredOption("--resource <resource>")
    .requiredOption("--tenant-id <id>")
    .option(
      "--rpc <url>",
      "RPC URL (optional; only needed if you want to derive from pk with provider)",
    )
    .action(async (opts) => {
      const provider = new JsonRpcProvider(opts.rpc)
      const wallet = new Wallet(opts.pk, provider)
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

      const signature = await signAgentProof({ wallet, proof })

      const res = await submitAgentTx({
        cfg: { base: opts.base, tenant_token: opts.tenant_token },
        sessionId: opts.sessionId,
        tx_hash: opts.txHash,
        wallet_address: wallet.address.toLowerCase(),
        signature: signature,
        proof,
      })

      console.log(JSON.stringify(res, null, 2))
    })
}
