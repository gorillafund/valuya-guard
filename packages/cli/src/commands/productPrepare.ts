import type { Command } from "commander"
import "dotenv/config"
import fs from "node:fs/promises"
import path from "node:path"
import { prepareProductForCreate } from "@valuya/agent"

function required(name: string): string {
  const v = process.env[name]
  if (!v) throw new Error(`Missing required env var: ${name}`)
  return v
}

async function readJson(file: string): Promise<any> {
  const p = path.resolve(process.cwd(), file)
  const raw = await fs.readFile(p, "utf8")
  return JSON.parse(raw)
}

export function cmdAgentProductPrepare(program: Command) {
  program
    .command("agent:product:prepare")
    .description(
      "Send product draft to backend and receive deterministic product payload (resource generated server-side)",
    )
    .requiredOption("--file <path>", "Path to draft json")
    .option("--out <path>", "Write prepared product JSON to file")
    .action(async (opts) => {
      const cfg = {
        base: required("VALUYA_BASE"),
        tenant_token: required("VALUYA_TENANT_TOKEN"),
      }
      const payload = await readJson(String(opts.file))
      const res = await prepareProductForCreate({ cfg, payload })

      if (opts.out) {
        const out = path.resolve(process.cwd(), String(opts.out))
        await fs.writeFile(out, JSON.stringify(res, null, 2) + "\n", "utf8")
      }

      console.log(JSON.stringify(res, null, 2))
    })
}

