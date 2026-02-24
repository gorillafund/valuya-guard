import type { Command } from "commander"
import "dotenv/config"
import { whoami } from "@valuya/agent"

function required(name: string): string {
  const v = process.env[name]
  if (!v) throw new Error(`Missing required env var: ${name}`)
  return v
}

export function cmdAgentWhoami(program: Command) {
  program
    .command("agent:whoami")
    .description("Resolve agent identity and principal subject from token")
    .action(async () => {
      const cfg = {
        base: required("VALUYA_BASE"),
        tenant_token: required("VALUYA_TENANT_TOKEN"),
      }

      const res = await whoami({ cfg })
      console.log(JSON.stringify(res, null, 2))
    })
}

