import type { Command } from "commander"
import "dotenv/config"
import fs from "node:fs/promises"
import path from "node:path"
import chalk from "chalk"

import { allowlistAdd } from "@valuya/agent"
import type { AllowlistAddRequest } from "@valuya/agent"

function requiredEnv(name: string): string {
  const v = process.env[name]
  if (!v) throw new Error(`Missing required env var: ${name}`)
  return v
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

async function readJsonFile(file: string): Promise<any> {
  const filePath = path.resolve(process.cwd(), file)
  const raw = await fs.readFile(filePath, "utf8")
  return JSON.parse(raw)
}

export function cmdAgentAllowlistAdd(program: Command) {
  program
    .command("allowlist:add")
    .description("Add a wallet to the allowlist (agent flow)")
    .option("--file <path>", "Path to allowlist.json")
    .option("--principal <type:id>", "Principal subject, e.g. user:123")
    .option("--wallet <address>", "Wallet address 0x…")
    .option("--plan <plan>", "Optional plan restriction")
    .option(
      "--resource-prefix <prefix>",
      "Optional resource prefix restriction",
    )
    .option("--max-amount-cents <n>", "Optional max amount in cents")
    .option("--expires-at <iso>", "Optional expiry ISO8601")
    .option("--status <active|disabled>", "Status", "active")
    .action(async (opts) => {
      try {
        logStep("Loading environment")

        const cfg = {
          base: requiredEnv("VALUYA_BASE"),
          tenant_token: requiredEnv("VALUYA_TENANT_TOKEN"),
        }

        let body: AllowlistAddRequest

        // Preferred: file input
        if (opts.file) {
          logStep(`Loading allowlist JSON: ${opts.file}`)
          const json = await readJsonFile(String(opts.file))
          body = json as AllowlistAddRequest
        } else {
          // Fallback: flags
          if (!opts.principal)
            throw new Error("Missing --principal (or use --file)")
          if (!opts.wallet) throw new Error("Missing --wallet (or use --file)")

          const [principal_subject_type, principal_subject_id] = String(
            opts.principal,
          ).split(":", 2)
          if (!principal_subject_type || !principal_subject_id) {
            throw new Error("--principal must be <type>:<id>")
          }

          body = {
            principal_subject_type,
            principal_subject_id,
            wallet_address: String(opts.wallet),
            plan: opts.plan ? String(opts.plan) : null,
            resource_prefix: opts.resourcePrefix
              ? String(opts.resourcePrefix)
              : null,
            max_amount_cents: opts.maxAmountCents
              ? Number(opts.maxAmountCents)
              : null,
            expires_at: opts.expiresAt ? String(opts.expiresAt) : null,
            status: (String(opts.status) as "active" | "disabled") ?? "active",
          }
        }

        // Minimal normalization (agent/back-end also validate)
        body.wallet_address = String(body.wallet_address).toLowerCase().trim()

        logStep("Calling allowlistAdd()")

        const res = await allowlistAdd({ cfg, body })

        logOk("Allowlist entry created/updated")
        console.log(chalk.gray(JSON.stringify(res, null, 2)))
        process.exit(0)
      } catch (err: any) {
        logErr(err?.message ?? String(err))
        if (err?.stack) console.error(chalk.gray(err.stack))
        process.exit(1)
      }
    })
}
