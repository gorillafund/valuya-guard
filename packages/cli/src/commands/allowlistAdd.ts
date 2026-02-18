import type { Command } from "commander"
import "dotenv/config"
import chalk from "chalk"
import { Wallet, isAddress } from "ethers"
import { allowlistAdd } from "@valuya/agent"

function required(name: string): string {
  const v = process.env[name]
  if (!v) throw new Error(`Missing required env var: ${name}`)
  return v
}

function parseSubject(sub: string): { type: string; id: string } {
  const [type, ...rest] = sub.split(":")
  const id = rest.join(":")
  if (!type || !id)
    throw new Error(`Invalid subject "${sub}" (expected "<type>:<id>")`)
  return { type, id }
}

export function cmdAgentAddAllowlist(program: Command) {
  program
    .command("agent:allowlist:add")
    .description("Add an agent wallet to the allowlist (tenant token required)")
    .action(async () => {
      const base = required("VALUYA_BASE")
      const tenant_token = required("VALUYA_TENANT_TOKEN")

      // principal = who authorizes this agent (for now: tenant:2 works; later: user:526)
      const principalSub = required("VALUYA_SUBJECT")
      const { type: principal_subject_type, id: principal_subject_id } =
        parseSubject(principalSub)

      // wallet to allowlist: use explicit env var if provided, otherwise derive from private key
      const walletAddressEnv = process.env.VALUYA_ALLOWLIST_WALLET
      const privateKey = process.env.VALUYA_PRIVATE_KEY

      let wallet_address = ""
      if (walletAddressEnv && walletAddressEnv.trim() !== "") {
        wallet_address = walletAddressEnv.trim().toLowerCase()
      } else {
        if (!privateKey)
          throw new Error(
            "Missing VALUYA_ALLOWLIST_WALLET or VALUYA_PRIVATE_KEY",
          )
        const w = new Wallet(privateKey)
        wallet_address = (await w.getAddress()).toLowerCase()
      }

      if (!isAddress(wallet_address)) {
        throw new Error(`Invalid wallet address: ${wallet_address}`)
      }

      const resource_prefix =
        process.env.VALUYA_ALLOWLIST_RESOURCE_PREFIX ?? null
      const plan = process.env.VALUYA_ALLOWLIST_PLAN ?? null

      const max_amount_cents =
        process.env.VALUYA_ALLOWLIST_MAX_AMOUNT_CENTS !== undefined
          ? Number(process.env.VALUYA_ALLOWLIST_MAX_AMOUNT_CENTS)
          : null

      const expires_at = process.env.VALUYA_ALLOWLIST_EXPIRES_AT ?? null
      const status =
        (process.env.VALUYA_ALLOWLIST_STATUS as
          | "active"
          | "disabled"
          | undefined) ?? "active"

      console.log(chalk.cyan("→ Adding wallet to allowlist..."))

      const out = await allowlistAdd({
        cfg: { base, tenant_token },
        body: {
          principal_subject_type,
          principal_subject_id,
          wallet_address,
          resource_prefix,
          plan,
          max_amount_cents: Number.isFinite(max_amount_cents as any)
            ? max_amount_cents
            : null,
          expires_at,
          status,
          meta: null,
        },
      })

      console.log(
        chalk.green(`✔ Allowlist updated: ${JSON.stringify(out, null, 2)}`),
      )
    })
}
