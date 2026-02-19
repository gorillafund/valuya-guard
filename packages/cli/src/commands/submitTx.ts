// packages/cli/src/commands/submitTx.ts
import type { Command } from "commander"
import { JsonRpcProvider } from "ethers"
import { makeEthersSigner } from "@valuya/agent"

import {
  getCheckoutSession, // you must have this in @valuya/agent; if not, use createCheckoutSession response or add show wrapper
  buildAgentPaymentProofFromSession,
  signAgentPaymentProofV2,
  submitAgentTx,
} from "@valuya/agent"

function must(v: any, name: string): string {
  if (!v) throw new Error(`Missing required option: ${name}`)
  return String(v)
}

export function cmdSubmitTx(program: Command) {
  program
    .command("submit-tx")
    .requiredOption("--base <url>")
    .requiredOption("--tenant-token <token>")
    .requiredOption("--pk <privateKey>")
    .requiredOption("--session-id <id>")
    .requiredOption("--tx-hash <hash>")
    .option("--rpc <url>", "RPC URL (optional, but recommended)")
    .action(async (opts) => {
      const base = must(opts.base, "base")
      const tenant_token = must(opts.tenantToken, "tenant-token")
      const pk = must(opts.pk, "pk")
      const sessionId = must(opts.sessionId, "session-id")
      const tx_hash = must(opts.txHash, "tx-hash").toLowerCase()

      const cfg = { base, tenant_token }

      // signer
      const provider = opts.rpc ? new JsonRpcProvider(opts.rpc) : undefined
      const signer = makeEthersSigner(pk, provider as JsonRpcProvider)

      // 1) Load session from server (so we can compute expires_at + get anchor_resource/pricing binding)
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

      // 2) Build proof from session + tx
      const proof = buildAgentPaymentProofFromSession({
        session,
        tx_hash,
        expires_at,
      })

      // 3) Sign proof
      const signature = await signAgentPaymentProofV2(signer, proof)
      const wallet_address = (await signer.getAddress()).toLowerCase()

      // 4) Submit
      const res = await submitAgentTx({
        cfg,
        sessionId,
        wallet_address,
        tx_hash,
        signature,
        proof,
      })

      console.log(JSON.stringify(res, null, 2))
    })
}
