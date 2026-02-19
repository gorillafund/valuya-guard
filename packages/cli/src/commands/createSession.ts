import type { Command } from "commander"
import type { GuardRequired } from "@valuya/core"
import { createCheckoutSession } from "@valuya/agent"

function requiredOpt(v: any, name: string): string {
  const s = String(v ?? "").trim()
  if (!s) throw new Error(`Missing --${name}`)
  return s
}

export function cmdCreateSession(program: Command) {
  program
    .command("session:create")
    .description("Create a checkout session for a subject/resource/plan")
    .requiredOption("--subject <type:id>", "Subject, e.g. user:123")
    .requiredOption("--resource <resource>", "Canonical resource")
    .requiredOption("--plan <plan>", "Plan (opaque string)")
    .option("--origin <origin>", "Optional origin")
    .option("--quantity <n>", "Requested quantity", "1")
    .action(async (opts) => {
      const base = requiredOpt(program.opts().base, "base")
      const tenant_token = requiredOpt(
        program.opts().tenantToken,
        "tenant-token",
      )

      const subjectRaw = requiredOpt(opts.subject, "subject")
      const [type, id] = subjectRaw.split(":", 2)
      if (!type || !id) throw new Error("--subject must be <type>:<id>")

      const required: GuardRequired = {
        type: "subscription",
        plan: String(opts.plan),
      }

      const session = await createCheckoutSession({
        cfg: { base, tenant_token },
        subject: { type, id },
        principal: { type, id },
        resource: String(opts.resource),
        plan: String(opts.plan),
        required,
        origin: opts.origin ? String(opts.origin) : undefined,
        quantity_requested: Number(opts.quantity ?? 1),
      })

      console.log(JSON.stringify(session, null, 2))
    })
}
