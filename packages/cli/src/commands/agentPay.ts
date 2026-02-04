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

export function cmdAgentPay(program: Command) {
  program
    .command("agent:pay")
    .description("Run full Valuya Guard agent payment flow")
    .action(async () => {
      try {
        // ─────────────────────────────────────────────
        // 1. Load config
        // ─────────────────────────────────────────────
        logStep("Loading environment")

        const cfg = {
          base: required("VALUYA_BASE"),
          tenanttoken: required("VALUYA_TENANT_TOKEN"),
        }

        const subject = required("VALUYA_SUBJECT")
        const resource = required("VALUYA_RESOURCE")
        const plan = required("VALUYA_PLAN")

        const privateKey = required("VALUYA_PRIVATE_KEY")
        const fromAddress = required("VALUYA_FROM_ADDRESS")

        const pollInterval = Number(process.env.VALUYA_POLL_INTERVAL ?? 3_000)
        const pollTimeout = Number(process.env.VALUYA_POLL_TIMEOUT ?? 60_000)

        const [subjectType, subjectId] = subject.split(":")

        // ─────────────────────────────────────────────
        // 2. Create checkout session
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

        // ─────────────────────────────────────────────
        // 3. Execute on-chain payment
        // ─────────────────────────────────────────────
        logStep("Sending on-chain transaction")

        const txHash = await sendTransaction({
          payment: session.payment,
        })

        logOk(`Transaction sent: ${txHash}`)

        // ─────────────────────────────────────────────
        // 4. Sign agent proof
        // ─────────────────────────────────────────────
        logStep("Signing agent proof")

        const wallet = new Wallet(privateKey)

        const signature = await signAgentProof({
          wallet,
          sessionId: session.session_id,
          txHash,
          resource,
          tenantId: "", // optional / future-proof
        })

        logOk("Proof signed")

        // ─────────────────────────────────────────────
        // 5. Submit transaction proof
        // ─────────────────────────────────────────────
        logStep("Submitting transaction proof")

        await submitAgentTx({
          cfg,
          sessionId: session.session_id,
          tx_hash: txHash,
          from_address: fromAddress,
          signature,
        })

        logOk("Transaction proof submitted")

        // ─────────────────────────────────────────────
        // 6. Verify until terminal state
        // ─────────────────────────────────────────────
        logStep("Verifying payment on-chain")

        const startedAt = Date.now()

        while (true) {
          const res = await verifySession({
            cfg,
            sessionId: session.session_id,
            from_address: fromAddress,
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
        logErr(err.message ?? String(err))
        if (err?.stack) console.error(chalk.gray(err.stack))
        process.exit(1)
      }
    })
}
