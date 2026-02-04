import type { Command } from "commander"
import { createCheckoutSession } from "@valuya/agent"

export function cmdCreateSession(program: Command) {
  program
    .command("create-session")
    .requiredOption("--base <url>")
    .option("--tenanttoken <token>", "Tenant token (Bearer token)")
    .requiredOption("--plan <plan>")
    .requiredOption("--resource <resource>")
    .requiredOption("--subject <subject>", 'e.g. "anon:526"')
    .option("--idempotency-key <key>")
    .action(async (opts) => {
      const [type, id] = String(opts.subject).split(":")
      const res = await createCheckoutSession({
        cfg: { base: opts.base, tenanttoken: opts.tenanttoken },
        plan: opts.plan,
        evaluated_plan: opts.plan,
        resource: opts.resource,
        subject: { type, id },
        required: { type: "subscription", plan: opts.plan },
        idempotencyKey: opts.idempotencyKey,
        success_url: "",
        cancel_url: "",
      })
      console.log(JSON.stringify(res, null, 2))
    })
}
