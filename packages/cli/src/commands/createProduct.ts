import type { Command } from "commander"
import "dotenv/config"
import { Wallet } from "ethers"
import chalk from "chalk"
import { createProductAsAgent } from "@valuya/agent"

function required(name: string): string {
  const v = process.env[name]
  if (!v) throw new Error(`Missing required env var: ${name}`)
  return v
}

export function cmdAgentProductCreate(program: Command) {
  program
    .command("agent:product:create")
    .description("Create a Product as an allowlisted agent")
    .action(async () => {
      const base = required("VALUYA_BASE")
      const tenant_token = required("VALUYA_TENANT_TOKEN")
      const subject = required("VALUYA_SUBJECT")
      const privateKey = required("VALUYA_PRIVATE_KEY")

      const [subjectType, subjectId] = subject.split(":")

      const product = {
        slug: process.env.PRODUCT_SLUG,
        name: required("PRODUCT_NAME"),
        description: process.env.PRODUCT_DESCRIPTION,
        category: process.env.PRODUCT_CATEGORY,
        tags: process.env.PRODUCT_TAGS
          ? process.env.PRODUCT_TAGS.split(",")
              .map((s) => s.trim())
              .filter(Boolean)
          : undefined,
        visibility: process.env.PRODUCT_VISIBILITY ?? "public",
        status: process.env.PRODUCT_STATUS ?? "active",
        currency: process.env.PRODUCT_CURRENCY ?? "EUR",
        usage_unit: process.env.PRODUCT_USAGE_UNIT ?? "call",
        usage_unit_label: process.env.PRODUCT_USAGE_UNIT_LABEL ?? "request",
        gateway_resource: required("PRODUCT_GATEWAY_RESOURCE"),
        gateway_resource_key: process.env.PRODUCT_GATEWAY_RESOURCE_KEY,
        pricing: process.env.PRODUCT_PRICE_CENTS
          ? {
              type: "per_call",
              amount_cents: Number(process.env.PRODUCT_PRICE_CENTS),
            }
          : undefined,
      }

      const wallet = new Wallet(privateKey)

      console.log(chalk.cyan("→ Creating product as agent..."))

      const out = await createProductAsAgent({
        cfg: { base, tenant_token },
        principal: { type: subjectType, id: subjectId },
        wallet,
        product,
      })

      console.log(
        chalk.green(`✔ Product created: ${JSON.stringify(out, null, 2)}`),
      )
    })
}
