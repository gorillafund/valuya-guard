import type { Command } from "commander"
import "dotenv/config"
import chalk from "chalk"
import { JsonRpcProvider, Wallet } from "ethers"
import {
  isValuyaApiError,
  parseProductRef,
  resolvePurchaseContext,
  purchase,
} from "@valuya/agent"
import { sendErc20Transfer } from "../chain/sendErc20.js"

function requiredEnv(name: string): string {
  const v = process.env[name]
  if (!v) throw new Error(`Missing required env var: ${name}`)
  return v
}

function optionalEnv(name: string): string | undefined {
  const v = process.env[name]
  return v && String(v).trim() ? String(v).trim() : undefined
}

function logStep(msg: string) {
  console.log(chalk.cyan(`→ ${msg}`))
}

function logOk(msg: string) {
  console.log(chalk.green(`✔ ${msg}`))
}

function printError(err: any) {
  if (isValuyaApiError(err)) {
    console.error(chalk.red(`✖ ${err.message}`))
    const d = err.details
    console.error(chalk.gray(`  ${d.method} ${d.url}`))
    if (d.code) console.error(chalk.gray(`  code: ${d.code}`))
    if (d.requestId) console.error(chalk.gray(`  request_id: ${d.requestId}`))
    if (d.body)
      console.error(chalk.gray(`  body: ${JSON.stringify(d.body, null, 2)}`))
    else if (d.rawText) console.error(chalk.gray(`  body: ${d.rawText}`))
    return
  }

  console.error(chalk.red(`✖ ${err?.message ?? String(err)}`))
  if (err?.stack) console.error(chalk.gray(err.stack))
}

function parseJsonOrText(txt: string): any {
  try {
    return JSON.parse(txt)
  } catch {
    return txt
  }
}

export function cmdAgentBuy(program: Command) {
  program
    .command("agent:buy")
    .description(
      "Guided flow: resolve product -> pay -> verify -> optionally call resource URL",
    )
    .requiredOption(
      "--product <ref>",
      "Product ref (id, slug, id:<n>, slug:<slug>, external:<id>)",
    )
    .option(
      "--resource-url <url>",
      "Protected resource URL to call after successful payment (overrides resolved visit_url)",
    )
    .option("--no-visit", "Skip resource call after payment")
    .option("--resource-auth <bearer>", "Optional bearer token for resource call")
    .option("--method <method>", "HTTP method for resource call", "GET")
    .action(async (opts) => {
      try {
        const base = requiredEnv("VALUYA_BASE")
        const tenant_token = requiredEnv("VALUYA_TENANT_TOKEN")
        const pk = requiredEnv("VALUYA_PRIVATE_KEY")
        const rpc = optionalEnv("VALUYA_RPC_URL")
        const pollIntervalMs = Number(process.env.VALUYA_POLL_INTERVAL ?? 3000)
        const pollTimeoutMs = Number(process.env.VALUYA_POLL_TIMEOUT ?? 60000)

        const provider = rpc ? new JsonRpcProvider(rpc) : undefined
        const wallet = provider ? new Wallet(pk, provider) : new Wallet(pk)
        const cfg = { base, tenant_token }

        const productRef = String(opts.product).trim()
        logStep(`Resolving product context: ${productRef}`)
        const ctx = await resolvePurchaseContext({
          cfg,
          product: parseProductRef(productRef),
        })

        logStep(
          `Resolved subject=${ctx.subject.type}:${ctx.subject.id} resource=${ctx.resource} plan=${ctx.plan}`,
        )

        const result = await purchase({
          cfg,
          signer: wallet,
          subject: ctx.subject,
          principal: ctx.principal,
          resource: ctx.resource,
          plan: ctx.plan,
          required: ctx.required,
          quantity_requested: ctx.quantity_requested,
          pollIntervalMs,
          pollTimeoutMs,
          sendTx: async (payment) => {
            if (!wallet.provider) {
              throw new Error(
                "VALUYA_RPC_URL required for onchain payments in agent:buy",
              )
            }
            return sendErc20Transfer({ signer: wallet, payment })
          },
        })

        logOk("Payment verified and mandate minted")

        if (opts.visit === false) {
          console.log(JSON.stringify(result.verify, null, 2))
          return
        }

        const resourceUrl =
          (opts.resourceUrl ? String(opts.resourceUrl).trim() : "") ||
          String(ctx.resolved.access?.visit_url ?? "").trim()

        if (!resourceUrl) {
          logStep(
            "No resource URL provided/resolved. Use --resource-url to perform visit step.",
          )
          console.log(JSON.stringify(result.verify, null, 2))
          return
        }

        logStep(`Calling protected resource: ${resourceUrl}`)
        const method = String(opts.method || "GET").toUpperCase()
        const auth = opts.resourceAuth
          ? String(opts.resourceAuth).trim()
          : optionalEnv("VALUYA_RESOURCE_AUTH")

        const headers: Record<string, string> = {
          Accept: "application/json, text/plain;q=0.9, */*;q=0.8",
          "X-Valuya-Subject-Id": `${ctx.subject.type}:${ctx.subject.id}`,
          "X-Valuya-Session-Id": result.session.session_id,
        }
        if (auth) headers.Authorization = `Bearer ${auth}`

        const resp = await fetch(resourceUrl, { method, headers })
        const txt = await resp.text()
        const body = parseJsonOrText(txt)

        if (!resp.ok) {
          throw new Error(
            `resource_call_failed:${resp.status}:${typeof body === "string" ? body.slice(0, 500) : JSON.stringify(body).slice(0, 500)}`,
          )
        }

        logOk(`Resource call succeeded (${resp.status})`)
        console.log(JSON.stringify(body, null, 2))
      } catch (err: any) {
        printError(err)
        process.exit(1)
      }
    })
}

