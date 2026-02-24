import type { Command } from "commander"
import "dotenv/config"
import { getProductCreateSchema } from "@valuya/agent"

function required(name: string): string {
  const v = process.env[name]
  if (!v) throw new Error(`Missing required env var: ${name}`)
  return v
}

export function cmdAgentProductSchema(program: Command) {
  program
    .command("agent:product:schema")
    .description("Fetch backend schema/examples for a product type")
    .requiredOption("--type <type>", "Product type key")
    .action(async (opts) => {
      const cfg = {
        base: required("VALUYA_BASE"),
        tenant_token: required("VALUYA_TENANT_TOKEN"),
      }
      const res = await getProductCreateSchema({
        cfg,
        type: String(opts.type),
      })
      console.log(JSON.stringify(res, null, 2))
    })
}

