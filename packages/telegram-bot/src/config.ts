import "dotenv/config"

function required(name: string): string {
  const v = process.env[name]
  if (!v) throw new Error(`Missing env var: ${name}`)
  return v
}

export type BotConfig = {
  telegramToken: string

  valuyaBase: string
  valuyatenant_token: string

  // Option A: one global resource for the whole bot
  resource: string
  plan: string

  currency: string
  amountCents: number

  // Agent execution wallet
  privateKey: string
  fromAddress: string

  // Optional: polling cadence for verify loop
  pollIntervalMs: number
  pollTimeoutMs: number
}

export function loadConfig(): BotConfig {
  return {
    telegramToken: required("TELEGRAM_BOT_TOKEN"),

    valuyaBase: required("VALUYA_BASE"),
    valuyatenant_token: required("VALUYA_TENANT_TOKEN"),

    resource: required("VALUYA_RESOURCE"), // e.g. telegram:bot:bd5bbad459b38ad6
    plan: (process.env.VALUYA_PLAN || "standard").trim(),

    currency: (process.env.VALUYA_CURRENCY || "EUR").trim().toUpperCase(),
    amountCents: Number(process.env.VALUYA_AMOUNT_CENTS || "9900"),

    privateKey: required("VALUYA_PRIVATE_KEY"),
    fromAddress: required("VALUYA_FROM_ADDRESS"),

    pollIntervalMs: Number(process.env.VALUYA_POLL_INTERVAL_MS || "3000"),
    pollTimeoutMs: Number(process.env.VALUYA_POLL_TIMEOUT_MS || "90000"),
  }
}
