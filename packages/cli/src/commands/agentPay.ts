// src/commands/agentPay.ts
import type { Command } from "commander"
import { isValuyaApiError } from "@valuya/agent"
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
    .action(async () => {
      try {
        logStep("Loading environment")

        const base = requiredEnv("VALUYA_BASE")
        const tenant_token = requiredEnv("VALUYA_TENANT_TOKEN")

        const subjectRaw = requiredEnv("VALUYA_SUBJECT") // "<type>:<id>"
        const resource = requiredEnv("VALUYA_RESOURCE")
        const plan = requiredEnv("VALUYA_PLAN")
        const pk = requiredEnv("VALUYA_PRIVATE_KEY")

        const rpc = requiredEnv("VALUYA_RPC_URL")
        const pollIntervalMs = Number(process.env.VALUYA_POLL_INTERVAL ?? 3000)
        const pollTimeoutMs = Number(process.env.VALUYA_POLL_TIMEOUT ?? 60000)

        const [subjectType, subjectId] = subjectRaw.split(":", 2)
        if (!subjectType || !subjectId) {
          throw new Error("VALUYA_SUBJECT must be <type>:<id>")
        }

        const provider = new JsonRpcProvider(rpc)
        const wallet = new Wallet(pk, provider)

        const cfg = { base, tenant_token }
        const required: GuardRequired = { type: "subscription", plan }

        logStep("Running purchase() flow")

        const derivedWalletAddress = (await wallet.getAddress()).toLowerCase()
        logStep(`Using wallet address: ${derivedWalletAddress}`)
        const result = await purchase({
          cfg,
          signer: wallet,
          subject: { type: subjectType, id: subjectId },
          resource,
          plan,
          required,
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
