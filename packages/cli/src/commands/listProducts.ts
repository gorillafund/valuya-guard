import type { Command } from "commander"
import "dotenv/config"
import chalk from "chalk"

function required(name: string): string {
  const v = process.env[name]
  if (!v) throw new Error(`Missing required env var: ${name}`)
  return v
}

export function cmdAgentProductsList(program: Command) {
  program
    .command("agent:products:list")
    .description("List products (agent/tenant_token)")
    .option("--status <status>", "Filter by status (active|draft|disabled)")
    .option(
      "--visibility <visibility>",
      "Filter by visibility (public|private|unlisted)",
    )
    .option("--q <query>", "Search query (name/slug)")
    .option("--limit <n>", "Page size", "50")
    .option("--cursor <cursor>", "Pagination cursor (opaque)")
    .action(async (opts) => {
      const base = required("VALUYA_BASE").replace(/\/+$/, "")
      const tenant_token = required("VALUYA_TENANT_TOKEN")

      const url = new URL(`${base}/api/v2/agent/products`)
      if (opts.status) url.searchParams.set("status", String(opts.status))
      if (opts.visibility)
        url.searchParams.set("visibility", String(opts.visibility))
      if (opts.q) url.searchParams.set("q", String(opts.q))
      if (opts.limit) url.searchParams.set("limit", String(opts.limit))
      if (opts.cursor) url.searchParams.set("cursor", String(opts.cursor))

      console.log(chalk.cyan(`→ Listing products: ${url.toString()}`))

      const res = await fetch(url.toString(), {
        method: "GET",
        headers: {
          accept: "application/json",
          authorization: `Bearer ${tenant_token}`,
        },
      })

      const body = await res.json().catch(() => ({}))

      if (!res.ok) {
        throw new Error(
          `agent:products:list_failed:${res.status}:${JSON.stringify(body)}`,
        )
      }

      console.log(chalk.green(`✔ OK`))
      console.log(JSON.stringify(body, null, 2))
    })
}
