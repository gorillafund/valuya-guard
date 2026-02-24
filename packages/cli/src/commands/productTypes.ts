import type { Command } from "commander"
import "dotenv/config"
import { listProductTypes } from "@valuya/agent"

function required(name: string): string {
  const v = process.env[name]
  if (!v) throw new Error(`Missing required env var: ${name}`)
  return v
}

export function cmdAgentProductTypes(program: Command) {
  program
    .command("agent:product:types")
    .description("List supported product types and pricing modalities")
    .action(async () => {
      const cfg = {
        base: required("VALUYA_BASE"),
        tenant_token: required("VALUYA_TENANT_TOKEN"),
      }
      const res = await listProductTypes({ cfg })
      console.log(JSON.stringify(res, null, 2))
    })
}

