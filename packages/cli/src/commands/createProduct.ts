// packages/cli/src/commands/agentProductCreate.ts

import type { Command } from "commander"
import fs from "node:fs/promises"
import path from "node:path"
import chalk from "chalk"
import { JsonRpcProvider } from "ethers"
import { createProductAsAgent } from "@valuya/agent"
import { makeEthersSigner } from "@valuya/agent"

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

export function cmdAgentProductCreate(program: Command) {
  program
    .command("agent:product:create")
    .description("Create a product via agent challenge flow")
    .requiredOption("--subject <type:id>", "Principal subject (e.g. user:123)")
    .requiredOption("--file <path>", "Path to product.json")
    .action(async (opts) => {
      try {
        logStep("Loading environment")

        const base = requiredEnv("VALUYA_BASE")
        const tenant_token = requiredEnv("VALUYA_TENANT_TOKEN")
        const pk = requiredEnv("VALUYA_PRIVATE_KEY")
        const rpc = requiredEnv("VALUYA_RPC_URL")

        const [subjectType, subjectId] = String(opts.subject).split(":", 2)
        if (!subjectType || !subjectId) {
          throw new Error("--subject must be in format <type>:<id>")
        }

        logStep("Loading product JSON")

        const filePath = path.resolve(process.cwd(), opts.file)
        const raw = await fs.readFile(filePath, "utf8")
        const product = JSON.parse(raw)

        const provider = new JsonRpcProvider(rpc)
        const signer = makeEthersSigner(pk, provider)

        const cfg = { base, tenant_token }

        logStep("Creating product via agent")

        const result = await createProductAsAgent({
          cfg,
          principal: { type: subjectType, id: subjectId },
          signer,
          product,
        })

        logOk("Product created successfully 🎉")
        console.log(chalk.gray(JSON.stringify(result, null, 2)))
        process.exit(0)
      } catch (err: any) {
        logErr(err?.message ?? String(err))
        if (err?.stack) console.error(chalk.gray(err.stack))
        process.exit(1)
      }
    })
}
