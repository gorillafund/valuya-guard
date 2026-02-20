// packages/agent/src/modules/purchase.ts
import type { AgentConfig } from "../types.js"
import type { GuardRequired, PaymentInstruction } from "@valuya/core"
import { createCheckoutSession } from "./checkoutSessions.js"
import { buildAgentPaymentProofFromSession } from "../protocol/buildProof.js"
import { signAgentPaymentProofV2 } from "../protocol/proof.js"
import { submitAgentTx, verifySession } from "../protocol/sessions.js"
import { pollUntil } from "../utils/poll.js"
import type { EvmSigner } from "../utils/evm.js"

const ZERO_TX = "0x" + "0".repeat(64)

function isFree(payment: PaymentInstruction): boolean {
  return (payment as any).is_free === true || (payment as any).method === "free"
}

function assertOkSubmit(res: any) {
  // submitTx returns { ok: true, ... } on success in your Laravel controller
  if (!res || res.ok !== true) {
    const msg = (res && (res.error || res.message)) || "submit_agent_tx_failed"
    throw new Error(msg)
  }
}

export async function purchase(args: {
  cfg: AgentConfig
  signer: EvmSigner
  subject: { type: string; id: string }
  principal?: { type: string; id: string } // optional, defaults to subject if not provided
  resource: string
  plan: string
  required: GuardRequired
  sendTx?: (
    payment: Extract<PaymentInstruction, { method: "onchain" }>,
  ) => Promise<string>
  origin?: string
  quantity_requested?: number
  pollIntervalMs?: number
  pollTimeoutMs?: number
}) {
  const pollIntervalMs = args.pollIntervalMs ?? 3000
  const pollTimeoutMs = args.pollTimeoutMs ?? 60000

  // 1) Create session
  const session = await createCheckoutSession({
    cfg: args.cfg,
    resource: args.resource,
    plan: args.plan,
    subject: args.subject,
    principal: args.principal ?? args.subject,
    required: args.required,
    origin: args.origin,
    quantity_requested: args.quantity_requested,
  })

  if (!session.payment) throw new Error("session_missing_payment_instruction")
  if (!session.server_time) throw new Error("session_missing_server_time")
  if (!session.agent_proof_ttl_seconds)
    throw new Error("session_missing_agent_proof_ttl_seconds")

  // 2) Determine tx hash
  let tx_hash = ZERO_TX
  if (!isFree(session.payment)) {
    if (session.payment.method !== "onchain") {
      throw new Error(`unsupported_payment_method:${session.payment.method}`)
    }
    if (!args.sendTx) {
      throw new Error("sendTx(payment) required for non-free purchases")
    }
    tx_hash = (await args.sendTx(session.payment)).toLowerCase()
  }

  // 3) Compute proof expiry using *server_time* + TTL (backend expects expires_at in proof)
  const serverMs = Date.parse(session.server_time)
  if (!Number.isFinite(serverMs)) {
    throw new Error(`invalid_server_time:${session.server_time}`)
  }
  const expires_at = new Date(
    serverMs + Number(session.agent_proof_ttl_seconds) * 1000,
  ).toISOString()

  // 4) Build + sign proof (must bind anchor_resource + pricing_hash + quantity_effective + routing)
  const proof = buildAgentPaymentProofFromSession({
    session,
    tx_hash,
    expires_at,
  })
  const signature = await signAgentPaymentProofV2(args.signer, proof)
  const wallet_address = (await args.signer.getAddress()).toLowerCase()

  // 5) Submit tx/proof (THIS creates CheckoutPayment on backend)
  const submit = await submitAgentTx({
    cfg: args.cfg,
    sessionId: session.session_id,
    wallet_address,
    tx_hash,
    signature,
    proof,
  })

  // Fail fast if the backend didn’t create the payment row
  assertOkSubmit(submit)

  // 6) Poll verify until ok
  const verify = await pollUntil({
    fn: () =>
      verifySession({
        cfg: args.cfg,
        sessionId: session.session_id,
        wallet_address,
      }),
    isDone: (r) => (r as any)?.ok === true,
    intervalMs: pollIntervalMs,
    timeoutMs: pollTimeoutMs,
  })

  return { session, submit, verify, tx_hash }
}
