export type GuardSubjectRef =
  | { id: string }
  | { type: string; external_id: string }

export type MarketplaceOrderIntent = {
  id?: number | string
  order_id?: string
  guard_subject_id?: number | string
  protocol_subject_header?: string
  merchant_slug?: string
  channel?: string
  amount_cents?: number
  currency?: string
  asset?: string
  status?: string
  checkout_token?: string
  checkout_expires_at?: string
}

export type MarketplaceOrderIntentRequestArgs = {
  baseUrl: string
  tenantToken: string
  guardSubject: GuardSubjectRef
  protocolSubjectHeader: string
  productId: number
  merchantSlug: string
  channel: "telegram"
  resource: string
  plan: string
  amountCents: number
  currency: string
  asset: string
  cart: unknown
  localOrderId: string
  logger?: (event: string, fields: Record<string, unknown>) => void
  fetchImpl?: typeof fetch
}

export type MarketplaceOrderIntentResponse = {
  ok?: boolean
  order?: MarketplaceOrderIntent
  checkout_url?: string
}

export type MarketplaceOrderCreateArgs = {
  baseUrl: string
  tenantToken: string
  guardSubject: GuardSubjectRef
  protocolSubjectHeader: string
  productId: number
  merchantSlug: string
  channel: "telegram"
  resource: string
  plan: string
  amountCents: number
  currency: string
  asset: string
  cart: unknown
  localOrderId: string
  issueCheckoutToken?: boolean
  logger?: (event: string, fields: Record<string, unknown>) => void
  fetchImpl?: typeof fetch
}

export async function createMarketplaceOrder(
  args: MarketplaceOrderCreateArgs,
): Promise<MarketplaceOrderIntentResponse> {
  return createMarketplaceOrderInternal(args)
}

export async function createMarketplaceOrderIntent(
  args: MarketplaceOrderIntentRequestArgs,
): Promise<MarketplaceOrderIntentResponse> {
  const body = await createMarketplaceOrderInternal({
    ...args,
    issueCheckoutToken: true,
  })
  if (!String(body?.checkout_url || "").trim()) {
    throw new Error("marketplace_checkout_url_missing_fail_safe")
  }
  return body
}

async function createMarketplaceOrderInternal(
  args: MarketplaceOrderCreateArgs,
): Promise<MarketplaceOrderIntentResponse> {
  const fetchImpl = args.fetchImpl || fetch
  const logger = args.logger || (() => {})
  const url = `${args.baseUrl.replace(/\/+$/, "")}/api/marketplace/orders`
  const protocolSubjectHeader = String(args.protocolSubjectHeader || "").trim()
  if (!protocolSubjectHeader) {
    throw new Error("marketplace_protocol_subject_missing_fail_safe")
  }
  const productId = normalizePositiveInt(args.productId)
  if (!productId) {
    throw new Error("marketplace_product_id_missing_fail_safe")
  }
  const resource = String(args.resource || "").trim()
  if (!resource) {
    throw new Error("marketplace_resource_missing_fail_safe")
  }
  const plan = String(args.plan || "").trim()
  if (!plan) {
    throw new Error("marketplace_plan_missing_fail_safe")
  }
  const amountCents = normalizeAmount(args.amountCents)
  if (!amountCents) {
    throw new Error("marketplace_amount_missing_fail_safe")
  }
  const guardSubject = normalizeGuardSubject(args.guardSubject)

  logger("marketplace_order_intent_request", {
    tenant: tokenPreview(args.tenantToken),
    local_order_id: args.localOrderId,
    guard_subject_id: "id" in guardSubject ? guardSubject.id : null,
    guard_subject_type: "type" in guardSubject ? guardSubject.type : null,
    guard_subject_external_id:
      "external_id" in guardSubject ? guardSubject.external_id : null,
    protocol_subject_header: protocolSubjectHeader,
    product_id: productId,
    merchant_slug: args.merchantSlug,
    channel: args.channel,
    resource,
    plan,
    amount_cents: amountCents,
  })

  const response = await fetchImpl(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${args.tenantToken}`,
      "Content-Type": "application/json",
      Accept: "application/json",
      "X-Valuya-Subject-Id": protocolSubjectHeader,
      "Idempotency-Key": `marketplace-order:${args.localOrderId}:v1`,
    },
    body: JSON.stringify({
      guard_subject: guardSubject,
      protocol_subject_header: protocolSubjectHeader,
      product_id: productId,
      merchant_slug: args.merchantSlug,
      channel: args.channel,
      resource,
      plan,
      amount_cents: amountCents,
      currency: args.currency,
      asset: args.asset,
      cart: args.cart,
      issue_checkout_token: args.issueCheckoutToken === true,
    }),
  })

  const body = (await safeParseJson(response)) as MarketplaceOrderIntentResponse
  logger("marketplace_order_intent_response", {
    tenant: tokenPreview(args.tenantToken),
    local_order_id: args.localOrderId,
    status: response.status,
    ok: response.ok && body?.ok !== false,
    valuya_order_id: body?.order?.order_id || null,
    checkout_url: body?.checkout_url || null,
  })

  if (!response.ok || body?.ok === false) {
    throw new Error(
      `marketplace_order_intent_failed:${response.status}:${JSON.stringify(body).slice(0, 300)}`,
    )
  }
  return body
}

export async function getMarketplaceOrder(args: {
  baseUrl: string
  tenantToken: string
  orderId: string
  protocolSubjectHeader: string
  fetchImpl?: typeof fetch
}): Promise<MarketplaceOrderIntentResponse> {
  const fetchImpl = args.fetchImpl || fetch
  const orderId = String(args.orderId || "").trim()
  if (!orderId) throw new Error("marketplace_order_id_required")
  const response = await fetchImpl(
    `${args.baseUrl.replace(/\/+$/, "")}/api/marketplace/orders/${encodeURIComponent(orderId)}`,
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${args.tenantToken}`,
        Accept: "application/json",
        "X-Valuya-Subject-Id": String(args.protocolSubjectHeader || "").trim(),
      },
    },
  )
  const body = (await safeParseJson(response)) as MarketplaceOrderIntentResponse
  if (!response.ok || body?.ok === false) {
    throw new Error(
      `marketplace_order_get_failed:${response.status}:${JSON.stringify(body).slice(0, 300)}`,
    )
  }
  return body
}

export async function createMarketplaceCheckoutLink(args: {
  baseUrl: string
  tenantToken: string
  orderId: string
  protocolSubjectHeader: string
  fetchImpl?: typeof fetch
}): Promise<{ ok?: boolean; checkout_url?: string }> {
  const fetchImpl = args.fetchImpl || fetch
  const orderId = String(args.orderId || "").trim()
  if (!orderId) throw new Error("marketplace_order_id_required")
  const response = await fetchImpl(
    `${args.baseUrl.replace(/\/+$/, "")}/api/marketplace/orders/${encodeURIComponent(orderId)}/checkout-link`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${args.tenantToken}`,
        "Content-Type": "application/json",
        Accept: "application/json",
        "X-Valuya-Subject-Id": String(args.protocolSubjectHeader || "").trim(),
      },
      body: JSON.stringify({}),
    },
  )
  const body = (await safeParseJson(response)) as { ok?: boolean; checkout_url?: string }
  if (!response.ok || body?.ok === false) {
    throw new Error(
      `marketplace_checkout_link_failed:${response.status}:${JSON.stringify(body).slice(0, 300)}`,
    )
  }
  return body
}

function normalizeAmount(value: number): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null
  const n = Math.trunc(value)
  return n > 0 ? n : null
}

function normalizePositiveInt(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null
  const n = Math.trunc(value)
  return n > 0 ? n : null
}

function normalizeGuardSubject(value: GuardSubjectRef): GuardSubjectRef {
  if ("id" in value) {
    const id = String(value.id || "").trim()
    if (!id) throw new Error("marketplace_guard_subject_missing_fail_safe")
    return { id }
  }
  const type = String(value.type || "").trim()
  const externalId = String(value.external_id || "").trim()
  if (!type || !externalId) {
    throw new Error("marketplace_guard_subject_missing_fail_safe")
  }
  return { type, external_id: externalId }
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

function tokenPreview(token: string): string {
  const t = String(token || "").trim()
  return t ? t.slice(0, 12) : "unknown"
}
