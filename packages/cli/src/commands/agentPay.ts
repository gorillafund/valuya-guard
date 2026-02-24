// src/commands/agentPay.ts
import type { Command } from "commander"
import {
  isValuyaApiError,
  parseProductRef,
  resolvePurchaseContext,
} from "@valuya/agent"
import "dotenv/config"
import chalk from "chalk"
import { JsonRpcProvider, Wallet } from "ethers"

import { purchase } from "@valuya/agent"
import type { GuardRequired } from "@valuya/core"
import { sendErc20Transfer } from "../chain/sendErc20.js"

function requiredEnv(name: string): string {
  const v = process.env[name]
  if (!v) throw new Error(`Missing required env var: ${name}`)
  return v
}

function optionalEnv(name: string): string | undefined {
  const v = process.env[name]
  return v && String(v).trim() ? String(v).trim() : undefined
}

function parseSubjectRaw(subjectRaw: string): { type: string; id: string } {
  const [type, id] = String(subjectRaw).split(":", 2)
  if (!type || !id) throw new Error("VALUYA_SUBJECT must be <type>:<id>")
  return { type, id }
}

function printError(err: any) {
  if (isValuyaApiError(err)) {
    console.error(chalk.red(`✖ ${err.message}`))
    const d = err.details
    console.error(chalk.gray(`  ${d.method} ${d.url}`))
    if (d.code) console.error(chalk.gray(`  code: ${d.code}`))
    if (d.requestId) console.error(chalk.gray(`  request_id: ${d.requestId}`))
    if (d.body)
      console.error(chalk.gray(`  body: ${JSON.stringify(d.body, null, 2)}`))
    else if (d.rawText) console.error(chalk.gray(`  body: ${d.rawText}`))
    return
  }

  console.error(chalk.red(`✖ ${err?.message ?? String(err)}`))
  if (err?.stack) console.error(chalk.gray(err.stack))
}

function logStep(msg: string) {
  console.log(chalk.cyan(`→ ${msg}`))
}
function logOk(msg: string) {
  console.log(chalk.green(`✔ ${msg}`))
}
function logErr(msg: string) {
  console.error(chalk.red(`✖ ${msg}`))
}

export function cmdAgentPay(program: Command) {
  program
    .command("agent:pay")
    .description(
      "Create session, pay (if needed), submit proof, verify, mint mandate",
    )
    .option(
      "--product <ref>",
      "Product ref (id, slug, id:<n>, slug:<slug>, external:<id>)",
    )
    .action(async (opts) => {
      try {
        logStep("Loading environment")

        const base = requiredEnv("VALUYA_BASE")
        const tenant_token = requiredEnv("VALUYA_TENANT_TOKEN")

        const pk = requiredEnv("VALUYA_PRIVATE_KEY")
        const rpc = requiredEnv("VALUYA_RPC_URL")

        const subjectRaw = optionalEnv("VALUYA_SUBJECT") // "<type>:<id>"
        const resource = optionalEnv("VALUYA_RESOURCE")
        const plan = optionalEnv("VALUYA_PLAN")
        const productRef =
          (opts?.product ? String(opts.product).trim() : "") ||
          optionalEnv("VALUYA_PRODUCT")

        const pollIntervalMs = Number(process.env.VALUYA_POLL_INTERVAL ?? 3000)
        const pollTimeoutMs = Number(process.env.VALUYA_POLL_TIMEOUT ?? 60000)

        const provider = new JsonRpcProvider(rpc)
        const wallet = new Wallet(pk, provider)

        const cfg = { base, tenant_token }
        let required: GuardRequired
        let subject: { type: string; id: string }
        let principal: { type: string; id: string } | undefined
        let resolvedResource: string
        let resolvedPlan: string
        let quantity_requested: number | undefined

        const hasExplicit =
          Boolean(subjectRaw && resource && plan)

        if (hasExplicit) {
          subject = parseSubjectRaw(String(subjectRaw))
          resolvedResource = String(resource)
          resolvedPlan = String(plan)
          required = { type: "subscription", plan: resolvedPlan }
        } else {
          if (!productRef) {
            throw new Error(
              "Missing product context. Provide --product (or VALUYA_PRODUCT), or set VALUYA_SUBJECT + VALUYA_RESOURCE + VALUYA_PLAN.",
            )
          }
          logStep(`Resolving context for product: ${productRef}`)
          const ctx = await resolvePurchaseContext({
            cfg,
            product: parseProductRef(productRef),
          })
          subject = ctx.subject
          principal = ctx.principal
          resolvedResource = ctx.resource
          resolvedPlan = ctx.plan
          required = ctx.required
          quantity_requested = ctx.quantity_requested
          logStep(
            `Resolved subject=${subject.type}:${subject.id}, resource=${resolvedResource}, plan=${resolvedPlan}`,
          )
        }

        logStep("Running purchase() flow")

        const derivedWalletAddress = (await wallet.getAddress()).toLowerCase()
        logStep(`Using wallet address: ${derivedWalletAddress}`)
        const result = await purchase({
          cfg,
          signer: wallet,
          subject,
          principal,
          resource: resolvedResource,
          plan: resolvedPlan,
          required,
          quantity_requested,
          pollIntervalMs,
          pollTimeoutMs,
          sendTx: async (payment) => {
            if (payment.method !== "onchain") {
              throw new Error(
                `Unsupported payment method for agent tx: ${payment.method}`,
              )
            }

            return sendErc20Transfer({ signer: wallet, payment })
          },
        })

        logOk("Mandate minted 🎉")
        console.log(chalk.gray(JSON.stringify(result.verify, null, 2)))
        process.exit(0)
      } catch (err: any) {
        printError(err)
        process.exit(1)
      }
    })
}
