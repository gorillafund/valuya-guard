import { Wallet } from "ethers"
import type { Subject } from "@valuya/core"
import {
  createCheckoutSession,
  submitAgentTx,
  signAgentProof,
  sendTransaction,
  verifySession,
  fetchEntitlements,
} from "@valuya/agent"

export type EnsureAccessArgs = {
  valuyaBase: string
  valuyatenant_token: string

  subject: Subject
  resource: string
  plan: string

  // If you want to influence routing (EUR/USD), keep this.
  // Backend decides pricing; client SHOULD NOT force amount.
  currency?: string

  privateKey: string

  pollIntervalMs: number
  pollTimeoutMs: number
}

export type EnsureAccessResult =
  | {
      ok: true
      state: "already_active" | "confirmed"
      sessionId?: string
      txHash?: string
      mandateId?: number
    }
  | {
      ok: false
      state: string
      sessionId?: string
      txHash?: string
      details?: any
    }

const ZERO_TX = "0x" + "0".repeat(64)

export async function ensureAccess(
  args: EnsureAccessArgs,
): Promise<EnsureAccessResult> {
  const cfg = { base: args.valuyaBase, tenant_token: args.valuyatenant_token }

  const wallet = new Wallet(args.privateKey)
  const walletAddress = (await wallet.getAddress()).toLowerCase()

  // 1) Check entitlements first (fast path)
  const ent = await fetchEntitlements({
    cfg,
    plan: args.plan,
    resource: args.resource,
    subject: { type: args.subject.type, id: args.subject.id },
  })

  if (ent?.active === true) {
    return { ok: true, state: "already_active" }
  }

  // 2) Create checkout session (server derives amount_cents from product/plan)
  const session = await createCheckoutSession({
    cfg,
    plan: args.plan,
    evaluated_plan: args.plan,
    resource: args.resource,
    subject: { type: args.subject.type, id: args.subject.id },
    required: { type: "subscription", plan: args.plan },

    // ✅ only if you want to steer currency; matches your backend validation shape
    ...(args.currency ? { currency: args.currency } : {}),
  })

  if (!session?.session_id) {
    return { ok: false, state: "session_create_failed", details: session }
  }

  if (!session.payment) {
    return {
      ok: false,
      state: "missing_payment_instruction",
      sessionId: session.session_id,
      details: session,
    }
  }

  let isFree = false
  if (session.payment.is_free) {
    isFree = session.payment.is_free === true
  }

  // 3) Send on-chain transfer (or free path)
  let txHash = ZERO_TX

  if (!isFree) {
    txHash = (await sendTransaction({ payment: session.payment })).toLowerCase()
  }

  // 4) Build proof expiry from server time (avoid agent clock skew)
  if (!session.server_time || !session.agent_proof_ttl_seconds) {
    return {
      ok: false,
      state: "missing_server_time_or_ttl",
      sessionId: session.session_id,
      details: session,
    }
  }

  const serverMs = Date.parse(session.server_time)
  if (!Number.isFinite(serverMs)) {
    return {
      ok: false,
      state: "invalid_server_time",
      sessionId: session.session_id,
      details: { server_time: session.server_time },
    }
  }

  const proofExpiresAt = new Date(
    serverMs + Number(session.agent_proof_ttl_seconds) * 1000,
  ).toISOString()

  // 5) Submit proof only if not free (depends on how you implemented free on backend)
  // If your backend mints mandate on free session without submitTx, this is correct.
  // If backend still expects a proof even for free, remove this if-guard.
  if (!isFree) {
    const proof = {
      session_id: session.session_id,
      tx_hash: txHash,
      resource: args.resource,
      required_hash: session.required_hash,

      chain_id: session.payment.chain_id,
      token_address: session.payment.token_address,
      to_address: session.payment.to_address,
      amount_raw: session.payment.amount_raw,

      expires_at: proofExpiresAt,
    }

    const signature = await signAgentProof({ wallet, proof })

    await submitAgentTx({
      cfg,
      sessionId: session.session_id,
      tx_hash: txHash,
      wallet_address: walletAddress,
      signature,
      proof,
    })
  }

  // 6) Verify (poll until confirmed / failed / timeout)
  const started = Date.now()

  while (true) {
    const res = await verifySession({
      cfg,
      sessionId: session.session_id,
      wallet_address: walletAddress,
    })

    if (res?.ok) {
      return {
        ok: true,
        state: "confirmed",
        sessionId: session.session_id,
        txHash: isFree ? undefined : txHash,
        mandateId: res?.mandate?.id ?? undefined,
      }
    }

    if (res?.state === "failed") {
      return {
        ok: false,
        state: "failed",
        sessionId: session.session_id,
        txHash: isFree ? undefined : txHash,
        details: res,
      }
    }

    if (Date.now() - started > args.pollTimeoutMs) {
      return {
        ok: false,
        state: "timeout",
        sessionId: session.session_id,
        txHash: isFree ? undefined : txHash,
        details: res,
      }
    }

    await new Promise((r) => setTimeout(r, args.pollIntervalMs))
  }
}
