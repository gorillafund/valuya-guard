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

function levenshtein(a: string, b: string): number {
  const aa = a.toLowerCase()
  const bb = b.toLowerCase()
  const dp = Array.from({ length: aa.length + 1 }, () =>
    new Array<number>(bb.length + 1).fill(0),
  )
  for (let i = 0; i <= aa.length; i++) dp[i][0] = i
  for (let j = 0; j <= bb.length; j++) dp[0][j] = j
  for (let i = 1; i <= aa.length; i++) {
    for (let j = 1; j <= bb.length; j++) {
      const cost = aa[i - 1] === bb[j - 1] ? 0 : 1
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + cost,
      )
    }
  }
  return dp[aa.length][bb.length]
}

async function fetchProductSuggestions(args: {
  base: string
  tenant_token: string
  query: string
}): Promise<string[]> {
  const base = args.base.replace(/\/+$/, "")
  const url = new URL(`${base}/api/v2/agent/products`)
  url.searchParams.set("q", args.query)
  url.searchParams.set("limit", "10")

  const res = await fetch(url.toString(), {
    method: "GET",
    headers: {
      accept: "application/json",
      authorization: `Bearer ${args.tenant_token}`,
    },
  })
  if (!res.ok) return []
  const body = await res.json().catch(() => ({}))
  const rows = Array.isArray(body?.data)
    ? body.data
    : Array.isArray(body?.items)
      ? body.items
      : Array.isArray(body)
        ? body
        : []

  const slugs = rows
    .map((x: any) => String(x?.slug ?? "").trim())
    .filter((x: string) => !!x)

  return Array.from(new Set(slugs))
}

function extractRefQuery(ref: string): string {
  if (ref.startsWith("slug:")) return ref.slice(5)
  if (ref.startsWith("id:")) return ref.slice(3)
  if (ref.startsWith("external:")) return ref.slice(9)
  return ref
}

async function handleResolveError(args: {
  err: any
  base: string
  tenant_token: string
  productRef: string
}): Promise<never> {
  const { err, base, tenant_token, productRef } = args
  if (isValuyaApiError(err) && err.details.code === "product_not_found") {
    const q = extractRefQuery(productRef).trim()
    const suggestions = await fetchProductSuggestions({
      base,
      tenant_token,
      query: q,
    })
    if (suggestions.length > 0) {
      const ranked = suggestions
        .map((s) => ({ s, score: levenshtein(q, s) }))
        .sort((a, b) => a.score - b.score)
        .slice(0, 3)
        .map((x) => `slug:${x.s}`)
      err.message = `${err.message}\n  suggestions: ${ranked.join(", ")}`
    }
  }
  throw err
}

async function executeResolvedAccess(args: {
  ctx: Awaited<ReturnType<typeof resolvePurchaseContext>>
  sessionId: string
  opts: any
}): Promise<void> {
  const { ctx, sessionId, opts } = args
  const auth = opts.resourceAuth
    ? String(opts.resourceAuth).trim()
    : optionalEnv("VALUYA_RESOURCE_AUTH")

  const invoke = ctx.resolved.access?.invoke
  if (invoke?.url) {
    const method = String(invoke.method || opts.method || "POST").toUpperCase()
    logStep(`Invoking protected endpoint (${method}): ${invoke.url}`)

    const headers: Record<string, string> = {
      Accept: "application/json, text/plain;q=0.9, */*;q=0.8",
      "X-Valuya-Subject-Id": `${ctx.subject.type}:${ctx.subject.id}`,
      "X-Valuya-Session-Id": sessionId,
      ...(invoke.headers ?? {}),
    }
    if (auth && !headers.Authorization) headers.Authorization = `Bearer ${auth}`
    if (invoke.body !== undefined && !headers["Content-Type"]) {
      headers["Content-Type"] = "application/json"
    }

    const body =
      invoke.body === undefined
        ? undefined
        : typeof invoke.body === "string"
          ? invoke.body
          : JSON.stringify(invoke.body)

    const resp = await fetch(String(invoke.url), { method, headers, body })
    const txt = await resp.text()
    const payload = parseJsonOrText(txt)
    if (!resp.ok) {
      throw new Error(
        `resource_invoke_failed:${resp.status}:${typeof payload === "string" ? payload.slice(0, 500) : JSON.stringify(payload).slice(0, 500)}`,
      )
    }
    logOk(`Resource invoke succeeded (${resp.status})`)
    console.log(JSON.stringify(payload, null, 2))
    return
  }

  const resourceUrl =
    (opts.resourceUrl ? String(opts.resourceUrl).trim() : "") ||
    String(ctx.resolved.access?.visit_url ?? "").trim()

  if (!resourceUrl) {
    logStep(
      "No invoke payload or visit_url provided/resolved. Use --resource-url to perform visit step.",
    )
    return
  }

  logStep(`Calling protected resource: ${resourceUrl}`)
  const method = String(opts.method || "GET").toUpperCase()
  const headers: Record<string, string> = {
    Accept: "application/json, text/plain;q=0.9, */*;q=0.8",
    "X-Valuya-Subject-Id": `${ctx.subject.type}:${ctx.subject.id}`,
    "X-Valuya-Session-Id": sessionId,
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
        }).catch((err) =>
          handleResolveError({ err, base, tenant_token, productRef }),
        )

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

        await executeResolvedAccess({
          ctx,
          sessionId: result.session.session_id,
          opts,
        })
        console.log(JSON.stringify(result.verify, null, 2))
      } catch (err: any) {
        printError(err)
        process.exit(1)
      }
    })
}
