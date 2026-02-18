import type { Command } from "commander"
import "dotenv/config"
import chalk from "chalk"
import { Wallet } from "ethers"

import {
  createCheckoutSession,
  signAgentProof,
  submitAgentTx,
  sendTransaction,
  verifySession,
} from "@valuya/agent"

function logStep(msg: string) {
  console.log(chalk.cyan(`→ ${msg}`))
}

function logOk(msg: string) {
  console.log(chalk.green(`✔ ${msg}`))
}

function logErr(msg: string) {
  console.error(chalk.red(`✖ ${msg}`))
}

function required(name: string): string {
  const v = process.env[name]
  if (!v) throw new Error(`Missing required env var: ${name}`)
  return v
}

const ZERO_TX = "0x" + "0".repeat(64)

export function cmdAgentPay(program: Command) {
  program
    .command("agent:pay")
    .description("Run full Valuya Guard agent payment flow")
    .action(async () => {
      try {
        // ─────────────────────────────────────────────
        // 1) Load config
        // ─────────────────────────────────────────────
        logStep("Loading environment")

        const cfg = {
          base: required("VALUYA_BASE"),
          tenant_token: required("VALUYA_TENANT_TOKEN"),
        }

        const subject = required("VALUYA_SUBJECT")
        const resource = required("VALUYA_RESOURCE")
        const plan = required("VALUYA_PLAN")
        const privateKey = required("VALUYA_PRIVATE_KEY")

        const pollInterval = Number(process.env.VALUYA_POLL_INTERVAL ?? 3_000)
        const pollTimeout = Number(process.env.VALUYA_POLL_TIMEOUT ?? 60_000)

        const [subjectType, subjectId] = subject.split(":")

        // ─────────────────────────────────────────────
        // 2) Create checkout session
        // ─────────────────────────────────────────────
        logStep("Creating checkout session")

        const session = await createCheckoutSession({
          cfg,
          plan,
          evaluated_plan: plan,
          resource,
          subject: { type: subjectType, id: subjectId },
          required: { type: "subscription", plan },
        })

        logOk(`Session created: ${session.session_id}`)

        if (!session.payment) {
          throw new Error("No payment instruction returned")
        }

        const isFree = session.payment.is_free
        if (isFree && isFree === true) {
          logOk(
            "Free checkout session — skipping on-chain transaction & proof submit",
          )

          // Just verify/poll until mandate is minted (or session becomes paid/failed)
          logStep("Verifying (free path)")

          const startedAt = Date.now()
          while (true) {
            const res = await verifySession({
              cfg,
              sessionId: session.session_id,
              wallet_address: (
                await new Wallet(privateKey).getAddress()
              ).toLowerCase(),
            })

            if (res.ok) {
              logOk("Mandate minted 🎉")
              console.log(chalk.gray(JSON.stringify(res, null, 2)))
              process.exit(0)
            }

            if (res.state === "failed") throw new Error("Verification failed")
            if (Date.now() - startedAt > pollTimeout)
              throw new Error("Verification timeout reached")

            await new Promise((r) => setTimeout(r, pollInterval))
          }
        }

        // ─────────────────────────────────────────────
        // 3) Execute on-chain payment (or free)
        // ─────────────────────────────────────────────
        let txHash: string

        if (isFree) {
          txHash = ZERO_TX
        } else {
          logStep("Sending on-chain transaction")

          txHash = await sendTransaction({ payment: session.payment })
          txHash = txHash.toLowerCase()

          logOk(`Transaction sent: ${txHash}`)
        }

        // ─────────────────────────────────────────────
        // 4) Sign agent proof
        // ─────────────────────────────────────────────
        logStep("Signing agent proof")

        const wallet = new Wallet(privateKey)
        const walletAddress = (await wallet.getAddress()).toLowerCase()

        if (!session.server_time || !session.agent_proof_ttl_seconds) {
          throw new Error(
            "Missing server_time or agent_proof_ttl_seconds in session response",
          )
        }

        const serverMs = Date.parse(session.server_time)
        if (!Number.isFinite(serverMs)) {
          throw new Error(`Invalid server_time: ${session.server_time}`)
        }

        // Keep ttl under server max (you set 540s on server)
        const proofExpiresAt = new Date(
          serverMs + Number(session.agent_proof_ttl_seconds) * 1000,
        ).toISOString()

        // Build proof (must match backend v2 message builder)
        const proof = {
          session_id: session.session_id,
          tx_hash: txHash,
          resource,
          required_hash: session.required_hash,
          chain_id: session.payment.chain_id,
          token_address: session.payment.token_address,
          to_address: session.payment.to_address,
          amount_raw: session.payment.amount_raw,
          expires_at: proofExpiresAt,
        }

        const signature = await signAgentProof({ wallet, proof })
        logOk("Proof signed")

        // ─────────────────────────────────────────────
        // 5) Submit transaction proof (ONCE)
        // ─────────────────────────────────────────────
        logStep("Submitting transaction proof")

        await submitAgentTx({
          cfg,
          sessionId: session.session_id,
          tx_hash: txHash,
          wallet_address: walletAddress,
          signature,
          proof,
        })

        logOk("Transaction proof submitted")

        // ─────────────────────────────────────────────
        // 6) Verify until terminal state
        // ─────────────────────────────────────────────
        logStep("Verifying payment on-chain")

        const startedAt = Date.now()

        while (true) {
          const res = await verifySession({
            cfg,
            sessionId: session.session_id,
            wallet_address: walletAddress,
          })

          if (res.ok) {
            logOk("Payment verified & mandate minted 🎉")
            console.log(chalk.gray(JSON.stringify(res, null, 2)))
            process.exit(0)
          }

          if (res.state === "failed") {
            throw new Error("Payment verification failed")
          }

          if (Date.now() - startedAt > pollTimeout) {
            throw new Error("Verification timeout reached")
          }

          await new Promise((r) => setTimeout(r, pollInterval))
        }
      } catch (err: any) {
        logErr(err?.message ?? String(err))
        if (err?.stack) console.error(chalk.gray(err.stack))
        process.exit(1)
      }
    })
}
