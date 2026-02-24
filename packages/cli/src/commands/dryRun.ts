import type { Command } from "commander"
import "dotenv/config"
import { parseProductRef, resolvePurchaseContext } from "@valuya/agent"

function requiredEnv(name: string): string {
  const v = process.env[name]
  if (!v) throw new Error(`Missing required env var: ${name}`)
  return v
}

export function cmdAgentDryRun(program: Command) {
  program
    .command("agent:dry-run")
    .description(
      "Resolve product into checkout + invoke plan without paying or invoking",
    )
    .requiredOption(
      "--product <ref>",
      "Product ref (id, slug, id:<n>, slug:<slug>, external:<id>)",
    )
    .action(async (opts) => {
      const cfg = {
        base: requiredEnv("VALUYA_BASE"),
        tenant_token: requiredEnv("VALUYA_TENANT_TOKEN"),
      }
      const ref = String(opts.product).trim()
      const ctx = await resolvePurchaseContext({
        cfg,
        product: parseProductRef(ref),
      })

      const out = {
        ok: true,
        product_ref: ref,
        subject: ctx.subject,
        principal: ctx.principal,
        checkout: {
          resource: ctx.resource,
          plan: ctx.plan,
          required: ctx.required,
          quantity_requested: ctx.quantity_requested ?? null,
        },
        access: {
          visit_url: ctx.resolved.access?.visit_url ?? null,
          invoke: ctx.resolved.access?.invoke ?? null,
        },
      }

      console.log(JSON.stringify(out, null, 2))
    })
}

