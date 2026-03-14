import {
  createValuyaMarketplaceHttpClient,
  type GuardSubjectRef,
} from "@valuya/marketplace-agent-core"
import type {
  DelegatedPaymentRequest,
  MarketplaceOrderRequest,
  PaymentGateway,
} from "../ports/PaymentGateway.js"

export class ValuyaPaymentGatewayAdapter implements PaymentGateway {
  private readonly baseUrl: string
  private readonly tenantToken: string
  private readonly defaultResource: string
  private readonly defaultPlan: string
  private readonly productId: number
  private readonly merchantSlug: string
  private readonly channel: string
  private readonly marketplaceClient: ReturnType<typeof createValuyaMarketplaceHttpClient>

  constructor(args: {
    baseUrl: string
    tenantToken: string
    resource: string
    plan: string
    productId: number
    merchantSlug?: string
    channel?: string
  }) {
    this.baseUrl = String(args.baseUrl || "").trim().replace(/\/+$/, "")
    this.tenantToken = String(args.tenantToken || "").trim()
    this.defaultResource = String(args.resource || "").trim()
    this.defaultPlan = String(args.plan || "").trim() || "standard"
    this.productId = Math.trunc(args.productId)
    this.merchantSlug = String(args.merchantSlug || "alfies").trim() || "alfies"
    this.channel = String(args.channel || "whatsapp").trim() || "whatsapp"
    this.marketplaceClient = createValuyaMarketplaceHttpClient({
      baseUrl: this.baseUrl,
      tenantToken: this.tenantToken,
    })

    if (!this.baseUrl) throw new Error("valuya_base_required")
    if (!this.tenantToken) throw new Error("valuya_tenant_token_required")
    if (!this.defaultResource) throw new Error("valuya_resource_required")
    if (!Number.isFinite(this.productId) || this.productId <= 0) {
      throw new Error("valuya_marketplace_product_id_required")
    }
  }

  async getEntitlement(args: {
    protocolSubjectHeader: string
    resource: string
    plan: string
  }): Promise<{ active: boolean; reason?: string }> {
    const url = new URL(`${this.baseUrl}/api/v2/entitlements`)
    url.searchParams.set("resource", String(args.resource || "").trim() || this.defaultResource)
    url.searchParams.set("plan", String(args.plan || "").trim() || this.defaultPlan)

    const response = await fetch(url.toString(), {
      method: "GET",
      headers: this.subjectHeaders(args.protocolSubjectHeader),
    })
    const body = await safeParseJson(response)
    if (!response.ok) {
      throw new Error(`valuya_entitlement_failed:${response.status}:${JSON.stringify(body).slice(0, 300)}`)
    }
    const record = toRecord(body)
    return {
      active: record.active === true,
      reason: typeof record.reason === "string" ? record.reason : undefined,
    }
  }

  async createMarketplaceOrder(args: MarketplaceOrderRequest): Promise<{
    valuyaOrderId: string
    checkoutUrl?: string
  }> {
    const record = toRecord(await this.marketplaceClient.createMarketplaceOrder({
      guardSubject: toGuardSubject(args),
      protocolSubjectHeader: args.protocolSubjectHeader,
      productId: this.productId,
      merchantSlug: this.merchantSlug,
      channel: this.channel,
      resource: this.defaultResource,
      plan: this.defaultPlan,
      amountCents: Math.trunc(args.amountCents),
      currency: args.currency,
      asset: args.asset,
      cart: args.cart,
      localOrderId: args.localOrderId,
      issueCheckoutToken: false,
    }))
    const order = toRecord(record.order)
    const valuyaOrderId = firstString(order.order_id, order.id)
    if (!valuyaOrderId) throw new Error("marketplace_order_id_missing_fail_safe")

    return {
      valuyaOrderId,
      checkoutUrl: firstString(record.checkout_url),
    }
  }

  async getMarketplaceOrder(args: {
    protocolSubjectHeader: string
    orderId: string
  }): Promise<Record<string, unknown>> {
    return toRecord(await this.marketplaceClient.getMarketplaceOrder({
      protocolSubjectHeader: args.protocolSubjectHeader,
      orderId: args.orderId,
    }))
  }

  async requestDelegatedPayment(args: DelegatedPaymentRequest): Promise<Record<string, unknown>> {
    const response = await fetch(`${this.baseUrl}/api/guard/payments/request`, {
      method: "POST",
      headers: {
        ...this.subjectHeaders(args.protocolSubjectHeader),
        "Content-Type": "application/json",
        "Idempotency-Key": args.idempotencyKey,
      },
      body: JSON.stringify({
        subject: toGuardSubject(args),
        principal_subject_type: args.principalSubjectType,
        principal_subject_id: args.principalSubjectId,
        wallet_address: args.walletAddress,
        actor_type: args.actorType,
        channel: args.channel,
        scope: args.scope,
        counterparty_type: args.counterpartyType,
        counterparty_id: args.counterpartyId,
        ...(args.merchantOrderId ? { merchant_order_id: args.merchantOrderId } : {}),
        ...(typeof args.amountCents === "number" ? { amount_cents: Math.trunc(args.amountCents) } : {}),
        currency: args.currency,
        asset: args.asset,
        ...(args.cart ? { cart: args.cart } : {}),
        idempotency_key: args.idempotencyKey,
        resource: this.defaultResource,
        plan: this.defaultPlan,
      }),
    })
    const body = await safeParseJson(response)
    if (!response.ok || toRecord(body).ok === false) {
      throw new Error(`delegated_payment_failed:${response.status}:${JSON.stringify(body).slice(0, 300)}`)
    }
    return toRecord(body)
  }

  async createCheckoutLink(args: {
    protocolSubjectHeader: string
    orderId: string
  }): Promise<{ checkoutUrl: string }> {
    const record = toRecord(await this.marketplaceClient.createCheckoutLink({
      protocolSubjectHeader: args.protocolSubjectHeader,
      orderId: args.orderId,
    }))
    const checkoutUrl = firstString(record.checkout_url)
    if (!checkoutUrl) throw new Error("marketplace_checkout_url_missing_fail_safe")
    return { checkoutUrl }
  }

  private subjectHeaders(protocolSubjectHeader: string): Record<string, string> {
    return {
      Authorization: `Bearer ${this.tenantToken}`,
      Accept: "application/json",
      "X-Valuya-Subject-Id": String(protocolSubjectHeader || "").trim(),
    }
  }
}

function toGuardSubject(args: {
  guardSubjectId?: string
  guardSubjectType?: string
  guardSubjectExternalId?: string
}): GuardSubjectRef {
  const id = String(args.guardSubjectId || "").trim()
  if (id) return { id }
  const type = String(args.guardSubjectType || "").trim()
  const externalId = String(args.guardSubjectExternalId || "").trim()
  if (!type || !externalId) throw new Error("guard_subject_missing_fail_safe")
  return { type, external_id: externalId }
}

function toRecord(value: unknown): Record<string, any> {
  return value && typeof value === "object" ? value as Record<string, any> : {}
}

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim()
    if (typeof value === "number" && Number.isFinite(value)) return String(Math.trunc(value))
  }
  return undefined
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
