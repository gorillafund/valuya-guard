import {
  createValuyaMarketplaceHttpClient,
} from "@valuya/marketplace-agent-core"

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
  const logger = args.logger || (() => {})
  const client = createValuyaMarketplaceHttpClient({
    baseUrl: args.baseUrl,
    tenantToken: args.tenantToken,
    fetchImpl: args.fetchImpl,
  })
  const protocolSubjectHeader = String(args.protocolSubjectHeader || "").trim()
  const amountCents = Math.trunc(args.amountCents)
  const guardSubject = args.guardSubject

  logger("marketplace_order_intent_request", {
    tenant: tokenPreview(args.tenantToken),
    local_order_id: args.localOrderId,
    guard_subject_id: "id" in guardSubject ? guardSubject.id : null,
    guard_subject_type: "type" in guardSubject ? guardSubject.type : null,
    guard_subject_external_id:
      "external_id" in guardSubject ? guardSubject.external_id : null,
    protocol_subject_header: protocolSubjectHeader,
    product_id: args.productId,
    merchant_slug: args.merchantSlug,
    channel: args.channel,
    resource: args.resource,
    plan: args.plan,
    amount_cents: amountCents,
  })

  const body = await client.createMarketplaceOrder({
    guardSubject,
    protocolSubjectHeader,
    productId: args.productId,
    merchantSlug: args.merchantSlug,
    channel: args.channel,
    resource: args.resource,
    plan: args.plan,
    amountCents: args.amountCents,
    currency: args.currency,
    asset: args.asset,
    cart: args.cart,
    localOrderId: args.localOrderId,
    issueCheckoutToken: args.issueCheckoutToken === true,
  }) as MarketplaceOrderIntentResponse
  logger("marketplace_order_intent_response", {
    tenant: tokenPreview(args.tenantToken),
    local_order_id: args.localOrderId,
    ok: body?.ok !== false,
    valuya_order_id: body?.order?.order_id || null,
    checkout_url: body?.checkout_url || null,
  })
  return body
}

export async function getMarketplaceOrder(args: {
  baseUrl: string
  tenantToken: string
  orderId: string
  protocolSubjectHeader: string
  fetchImpl?: typeof fetch
}): Promise<MarketplaceOrderIntentResponse> {
  const client = createValuyaMarketplaceHttpClient({
    baseUrl: args.baseUrl,
    tenantToken: args.tenantToken,
    fetchImpl: args.fetchImpl,
  })
  return await client.getMarketplaceOrder({
    orderId: args.orderId,
    protocolSubjectHeader: args.protocolSubjectHeader,
  }) as MarketplaceOrderIntentResponse
}

export async function createMarketplaceCheckoutLink(args: {
  baseUrl: string
  tenantToken: string
  orderId: string
  protocolSubjectHeader: string
  fetchImpl?: typeof fetch
}): Promise<{ ok?: boolean; checkout_url?: string }> {
  const client = createValuyaMarketplaceHttpClient({
    baseUrl: args.baseUrl,
    tenantToken: args.tenantToken,
    fetchImpl: args.fetchImpl,
  })
  return await client.createCheckoutLink({
    orderId: args.orderId,
    protocolSubjectHeader: args.protocolSubjectHeader,
  })
}

function tokenPreview(token: string): string {
  const t = String(token || "").trim()
  return t ? t.slice(0, 12) : "unknown"
}
