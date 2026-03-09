export type ManagedAgentCapacityResponse = {
  ok?: boolean
  asset?: string
  currency?: string
  as_of?: string
  agents?: Array<{
    wallet_balance?: {
      amount_cents?: number
    } | null
    wallet_spendable_cents?: number
    entries?: Array<{
      spendable_now_cents?: number
    }>
  }>
}

export type ManagedAgentCapacitySummary = {
  walletBalanceCents: number
  overallSpendableCents: number
  botSpendableNowCents: number
  currency: string
}

type LogFn = (event: string, fields: Record<string, unknown>) => void

export async function fetchManagedAgentCapacity(args: {
  baseUrl: string
  tenantToken: string
  subjectHeader: string
  resource: string
  plan: string
  asset: string
  currency: string
  logger?: LogFn
  fetchImpl?: typeof fetch
}): Promise<ManagedAgentCapacityResponse> {
  const fetchImpl = args.fetchImpl || fetch
  const logger = args.logger || (() => {})
  const url = new URL(`${args.baseUrl.replace(/\/+$/, "")}/api/v2/me/managed-agents/capacity`)
  url.searchParams.set("resource", args.resource)
  url.searchParams.set("plan", args.plan)
  url.searchParams.set("asset", args.asset)
  url.searchParams.set("currency", args.currency)

  logger("managed_agent_capacity_request", {
    subjectHeader: args.subjectHeader,
    resource: args.resource,
    plan: args.plan,
    asset: args.asset,
    currency: args.currency,
  })

  const response = await fetchImpl(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${args.tenantToken}`,
      Accept: "application/json",
      "X-Valuya-Subject-Id": args.subjectHeader,
    },
  })

  const body = (await safeParseJson(response)) as ManagedAgentCapacityResponse
  logger("managed_agent_capacity_response", {
    subjectHeader: args.subjectHeader,
    resource: args.resource,
    plan: args.plan,
    status: response.status,
    ok: response.ok && body?.ok !== false,
    responseBody: body,
  })

  if (!response.ok || body?.ok === false) {
    throw new Error(`managed_agent_capacity_failed:${response.status}:${JSON.stringify(body).slice(0, 300)}`)
  }

  return body
}

export function summarizeManagedAgentCapacity(
  body: ManagedAgentCapacityResponse,
): ManagedAgentCapacitySummary {
  const agents = Array.isArray(body.agents) ? body.agents : []
  let walletBalanceCents = 0
  let overallSpendableCents = 0
  let botSpendableNowCents = 0

  for (const agent of agents) {
    walletBalanceCents += toInt(agent.wallet_balance?.amount_cents) || 0
    overallSpendableCents += toInt(agent.wallet_spendable_cents) || 0
    const entries = Array.isArray(agent.entries) ? agent.entries : []
    for (const entry of entries) {
      botSpendableNowCents += toInt(entry.spendable_now_cents) || 0
    }
  }

  return {
    walletBalanceCents,
    overallSpendableCents,
    botSpendableNowCents,
    currency: String(body.currency || "").trim() || "EUR",
  }
}

export function formatCapacityAmount(cents: number, currency: string): string {
  return new Intl.NumberFormat("de-DE", {
    style: "currency",
    currency: currency || "EUR",
  }).format(cents / 100)
}

async function safeParseJson(response: Response): Promise<unknown> {
  const text = await response.text()
  if (!text) return {}
  try {
    return JSON.parse(text)
  } catch {
    return { raw: text }
  }
}

function toInt(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return Math.trunc(value)
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return Math.trunc(parsed)
  }
  return undefined
}
