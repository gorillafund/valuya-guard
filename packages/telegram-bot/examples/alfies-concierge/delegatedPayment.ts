export type DelegatedPaymentRequestArgs = {
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
}

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

export async function requestDelegatedPayment(
  args: DelegatedPaymentRequestArgs,
): Promise<unknown> {
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
  const hasMerchantOrderId = Boolean(merchantOrderId)
  const amountCents =
    typeof args.amountCents === "number" && Number.isFinite(args.amountCents) && args.amountCents > 0
      ? Math.trunc(args.amountCents)
      : undefined
  const hasAmountFallback = Boolean(amountCents)
  if (!hasMerchantOrderId && !hasAmountFallback) {
    throw new Error("delegated_payment_input_missing_fail_safe")
  }
  const fetchImpl = args.fetchImpl || fetch
  const logger = args.logger || (() => {})
  const url = `${args.baseUrl.replace(/\/+$/, "")}/api/guard/payments/request`

  logger("delegated_payment_request", {
    tenant: tokenPreview(args.tenantToken),
    protocol_subject_header: protocolSubjectHeader,
    delegated_payment_subject_kind: "guard_subject",
    guard_subject_id: hasGuardSubjectById ? guardSubjectId : null,
    guard_subject_type: hasGuardSubjectByTuple ? guardSubjectType : null,
    guard_subject_external_id: hasGuardSubjectByTuple ? guardSubjectExternalId : null,
    principal_subject_type: args.principalSubjectType,
    principal_subject_id: args.principalSubjectId,
    wallet_address: args.walletAddress,
    wallet_source: "linked_privy_wallet",
    linked_privy_wallet_address: args.walletAddress,
    guard_agent_wallet_address: null,
    resource: args.resource,
    plan: args.plan,
    scope: args.scope,
    counterparty_type: args.counterpartyType,
    counterparty_id: args.counterpartyId,
    merchant_order_id: hasMerchantOrderId ? merchantOrderId : null,
    amount_cents: amountCents ?? null,
    idempotency_key: args.idempotencyKey,
    delegated_mode: hasMerchantOrderId ? "merchant_order" : "amount_fallback",
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
      ...(hasMerchantOrderId ? { merchant_order_id: merchantOrderId } : {}),
      ...(hasAmountFallback ? { amount_cents: amountCents } : {}),
      currency: args.currency,
      asset: args.asset,
      ...(hasAmountFallback && args.cart ? { cart: args.cart } : {}),
      idempotency_key: args.idempotencyKey,
      resource: args.resource,
      plan: args.plan,
    }),
  })

  const body = await safeParseJson(resp)
  logger("delegated_payment_response", {
    tenant: tokenPreview(args.tenantToken),
    protocol_subject_header: protocolSubjectHeader,
    delegated_payment_subject_kind: "guard_subject",
    guard_subject_id: hasGuardSubjectById ? guardSubjectId : null,
    guard_subject_type: hasGuardSubjectByTuple ? guardSubjectType : null,
    guard_subject_external_id: hasGuardSubjectByTuple ? guardSubjectExternalId : null,
    merchant_order_id: hasMerchantOrderId ? merchantOrderId : null,
    amount_cents: amountCents ?? null,
    status: resp.status,
    ok: resp.ok && readBoolean(readRecord(body)?.ok, true),
    error_code:
      readString(readRecord(body)?.code) ||
      readString(readRecord(body)?.error) ||
      null,
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

function readString(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim()) return value.trim()
  return undefined
}

function readBoolean(value: unknown, fallback: boolean): boolean {
  if (typeof value === "boolean") return value
  return fallback
}

function tokenPreview(token: string): string {
  const t = String(token || "").trim()
  return t ? t.slice(0, 12) : "unknown"
}

function extractTopupUrl(body: unknown): string | undefined {
  const record = readRecord(body)
  const candidates = [
    record?.topup_url,
    record?.top_up_url,
    record?.funding_url,
    record?.recharge_url,
    record?.checkout_url,
  ]
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) return candidate.trim()
  }
  return undefined
}
