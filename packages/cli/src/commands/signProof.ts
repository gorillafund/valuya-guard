// packages/cli/src/commands/signProof.ts
import type { Command } from "commander"
import { JsonRpcProvider } from "ethers"

import {
  makeEthersSigner,
  getCheckoutSession, // you must have this in @valuya/agent; if not, use createCheckoutSession response or add show wrapper
  buildAgentPaymentProofFromSession,
  signAgentPaymentProofV2,
} from "@valuya/agent"

function must(v: any, name: string): string {
  if (!v) throw new Error(`Missing required option: ${name}`)
  return String(v)
}

export function cmdSignProof(program: Command) {
  program
    .command("sign-proof")
    .requiredOption("--base <url>")
    .requiredOption("--tenant-token <token>")
    .requiredOption("--pk <privateKey>")
    .requiredOption("--session-id <id>")
    .requiredOption("--tx-hash <hash>")
    .option("--rpc <url>")
    .action(async (opts) => {
      const cfg = {
        base: must(opts.base, "base"),
        tenant_token: must(opts.tenantToken, "tenant-token"),
      }

      const provider = opts.rpc ? new JsonRpcProvider(opts.rpc) : undefined

      const signer = makeEthersSigner(
        must(opts.pk, "pk"),
        provider as JsonRpcProvider,
      )

      const sessionId = must(opts.sessionId, "session-id")
      const tx_hash = must(opts.txHash, "tx-hash").toLowerCase()

      const session = await getCheckoutSession({ cfg, sessionId })

      if (!session.server_time || !session.agent_proof_ttl_seconds) {
        throw new Error("session_missing_server_time_or_ttl")
      }

      const serverMs = Date.parse(session.server_time)
      if (!Number.isFinite(serverMs)) {
        throw new Error(`invalid_server_time:${session.server_time}`)
      }

      const expires_at = new Date(
        serverMs + Number(session.agent_proof_ttl_seconds) * 1000,
      ).toISOString()

      const proof = buildAgentPaymentProofFromSession({
        session,
        tx_hash,
        expires_at,
      })

      const sig = await signAgentPaymentProofV2(signer, proof)

      console.log(
        JSON.stringify(
          {
            wallet_address: (await signer.getAddress()).toLowerCase(),
            signature: sig,
            proof,
          },
          null,
          2,
        ),
      )
    })
}
