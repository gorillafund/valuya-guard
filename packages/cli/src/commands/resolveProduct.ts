import type { Command } from "commander"
import "dotenv/config"
import { parseProductRef, resolveProduct } from "@valuya/agent"

function required(name: string): string {
  const v = process.env[name]
  if (!v) throw new Error(`Missing required env var: ${name}`)
  return v
}

export function cmdAgentProductResolve(program: Command) {
  program
    .command("agent:product:resolve")
    .description("Resolve product into purchase context (resource/plan/required)")
    .requiredOption(
      "--product <ref>",
      "Product ref (id, slug, id:<n>, slug:<slug>, external:<id>)",
    )
    .action(async (opts) => {
      const cfg = {
        base: required("VALUYA_BASE"),
        tenant_token: required("VALUYA_TENANT_TOKEN"),
      }
      const input = parseProductRef(String(opts.product))
      const res = await resolveProduct({ cfg, input })
      console.log(JSON.stringify(res, null, 2))
    })
}

