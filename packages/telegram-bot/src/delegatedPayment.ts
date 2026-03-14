export class DelegatedPaymentError extends Error {
  readonly status: number
  readonly body: unknown
  readonly code: string
  readonly state: string
  readonly topupUrl?: string

  constructor(status: number, body: unknown) {
    const record = readRecord(body)
    const code = String(record?.code || record?.error || "").trim().toLowerCase()
    const state = String(record?.state || readRecord(record?.session)?.state || "").trim().toLowerCase()
    super(`delegated_payment_request_failed:${status}:${JSON.stringify(body).slice(0, 300)}`)
    this.status = status
    this.body = body
    this.code = code
    this.state = state
    this.topupUrl = extractTopupUrl(body)
  }
}

export async function requestDelegatedPayment(args: {
  baseUrl: string
  tenantToken: string
  protocolSubjectHeader: string
  guardSubjectId?: string
  guardSubjectType?: string
  guardSubjectExternalId?: string
  principalSubjectType: string
  principalSubjectId: string
  walletAddress: string
  actorType: "agent"
  channel: "telegram"
  scope: string
  counterpartyType: string
  counterpartyId: string
  merchantOrderId?: string
  amountCents?: number
  currency: string
  asset: string
  cart?: unknown
  idempotencyKey: string
  resource: string
  plan: string
  logger?: (event: string, fields: Record<string, unknown>) => void
  fetchImpl?: typeof fetch
}): Promise<unknown> {
  const fetchImpl = args.fetchImpl || fetch
  const logger = args.logger || (() => {})
  const protocolSubjectHeader = String(args.protocolSubjectHeader || "").trim()
  const guardSubjectId = String(args.guardSubjectId || "").trim()
  const guardSubjectType = String(args.guardSubjectType || "").trim()
  const guardSubjectExternalId = String(args.guardSubjectExternalId || "").trim()
  const hasGuardSubjectById = Boolean(guardSubjectId)
  const hasGuardSubjectByTuple = Boolean(guardSubjectType && guardSubjectExternalId)
  if (!hasGuardSubjectById && !hasGuardSubjectByTuple) {
    throw new Error("delegated_payment_guard_subject_missing_fail_safe")
  }

  const merchantOrderId = String(args.merchantOrderId || "").trim()
  const amountCents =
    typeof args.amountCents === "number" && Number.isFinite(args.amountCents) && args.amountCents > 0
      ? Math.trunc(args.amountCents)
      : undefined
  const url = `${args.baseUrl.replace(/\/+$/, "")}/api/guard/payments/request`

  logger("delegated_payment_request", {
    protocol_subject_header: protocolSubjectHeader,
    merchant_order_id: merchantOrderId || null,
    amount_cents: amountCents ?? null,
    idempotency_key: args.idempotencyKey,
    resource: args.resource,
    plan: args.plan,
  })

  const resp = await fetchImpl(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${args.tenantToken}`,
      "Content-Type": "application/json",
      Accept: "application/json",
      "X-Valuya-Subject-Id": protocolSubjectHeader,
      "Idempotency-Key": args.idempotencyKey,
    },
    body: JSON.stringify({
      subject: hasGuardSubjectById
        ? { id: guardSubjectId }
        : { type: guardSubjectType, external_id: guardSubjectExternalId },
      principal_subject_type: args.principalSubjectType,
      principal_subject_id: args.principalSubjectId,
      wallet_address: args.walletAddress,
      actor_type: args.actorType,
      channel: args.channel,
      scope: args.scope,
      counterparty_type: args.counterpartyType,
      counterparty_id: args.counterpartyId,
      ...(merchantOrderId ? { merchant_order_id: merchantOrderId } : {}),
      ...(amountCents ? { amount_cents: amountCents } : {}),
      currency: args.currency,
      asset: args.asset,
      ...(amountCents && args.cart ? { cart: args.cart } : {}),
      idempotency_key: args.idempotencyKey,
      resource: args.resource,
      plan: args.plan,
    }),
  })

  const body = await safeParseJson(resp)
  logger("delegated_payment_response", {
    protocol_subject_header: protocolSubjectHeader,
    merchant_order_id: merchantOrderId || null,
    amount_cents: amountCents ?? null,
    status: resp.status,
    response_body: body,
  })
  if (!resp.ok || readBoolean(readRecord(body)?.ok, true) === false) {
    throw new DelegatedPaymentError(resp.status, body)
  }
  return body
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

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null
}

function readBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback
}

function extractTopupUrl(body: unknown): string | undefined {
  const record = readRecord(body)
  const candidates = [record?.topup_url, record?.top_up_url, record?.funding_url, record?.recharge_url, record?.checkout_url]
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) return candidate.trim()
  }
  return undefined
}
