export type GuardSubjectRef =
  | { id: string }
  | { type: string; external_id: string }

export type MarketplaceOrderIntentResponse = {
  ok?: boolean
  order?: {
    order_id?: string
    status?: string
  }
  checkout_url?: string
}

export async function createMarketplaceOrder(args: {
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
}): Promise<MarketplaceOrderIntentResponse> {
  const fetchImpl = args.fetchImpl || fetch
  const logger = args.logger || (() => {})
  const url = `${args.baseUrl.replace(/\/+$/, "")}/api/marketplace/orders`
  const protocolSubjectHeader = String(args.protocolSubjectHeader || "").trim()
  if (!protocolSubjectHeader) throw new Error("marketplace_protocol_subject_missing_fail_safe")

  logger("marketplace_order_request", {
    local_order_id: args.localOrderId,
    protocol_subject_header: protocolSubjectHeader,
    product_id: args.productId,
    merchant_slug: args.merchantSlug,
    resource: args.resource,
    plan: args.plan,
    amount_cents: args.amountCents,
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
      guard_subject: args.guardSubject,
      protocol_subject_header: protocolSubjectHeader,
      product_id: args.productId,
      merchant_slug: args.merchantSlug,
      channel: args.channel,
      resource: args.resource,
      plan: args.plan,
      amount_cents: args.amountCents,
      currency: args.currency,
      asset: args.asset,
      cart: args.cart,
      issue_checkout_token: args.issueCheckoutToken === true,
    }),
  })

  const body = (await safeParseJson(response)) as MarketplaceOrderIntentResponse
  logger("marketplace_order_response", {
    local_order_id: args.localOrderId,
    status: response.status,
    ok: response.ok && body?.ok !== false,
    valuya_order_id: body?.order?.order_id || null,
    checkout_url: body?.checkout_url || null,
  })
  if (!response.ok || body?.ok === false) {
    throw new Error(`marketplace_order_failed:${response.status}:${JSON.stringify(body).slice(0, 300)}`)
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
  const response = await fetchImpl(
    `${args.baseUrl.replace(/\/+$/, "")}/api/marketplace/orders/${encodeURIComponent(args.orderId)}/checkout-link`,
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
    throw new Error(`marketplace_checkout_link_failed:${response.status}:${JSON.stringify(body).slice(0, 300)}`)
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
