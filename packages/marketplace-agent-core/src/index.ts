export type MarketplaceChannel = "whatsapp" | "telegram" | (string & {})

export type MerchantIntegrationRef = {
  merchantSlug: string
  resource: string
  plan: string
}

export type CatalogDeliveryType = "delivery" | "pickup" | "shipping" | (string & {})

export type CatalogImage = {
  url: string
  alt?: string
}

export type NormalizedCatalogItem = {
  merchantProductId: string
  title: string
  description?: string
  priceCents: number
  currency: string
  imageUrl?: string
  category?: string
  tags?: string[]
  availability?: "in_stock" | "out_of_stock" | "limited" | (string & {})
  resource: string
  plan: string
  meta?: Record<string, unknown>
}

export type CatalogQueryContext = {
  merchantSlug: string
  channel: MarketplaceChannel
  protocolSubjectHeader: string
  locale?: string
  cursor?: string | null
  limit: number
  query?: string
  category?: string
}

export type CatalogQueryResult = {
  ok: true
  merchant: string
  items: NormalizedCatalogItem[]
  nextCursor: string | null
}

export type BasketLine = {
  merchantProductId: string
  title: string
  qty: number
  unitPriceCents: number
  currency: string
  resource?: string
  plan?: string
  meta?: Record<string, unknown>
}

export type DeliverySelection = {
  type: CatalogDeliveryType
  address?: Record<string, unknown>
  note?: string
  slot?: Record<string, unknown>
}

export type MarketplaceOrderState =
  | "draft"
  | "awaiting_checkout"
  | "payment_pending"
  | "paid_confirmed"
  | "submitted_to_merchant"
  | "failed"

export type MarketplaceOrder = {
  localOrderId: string
  valuyaOrderId: string
  merchantSlug: string
  protocolSubjectHeader: string
  channel: MarketplaceChannel
  amountCents: number
  currency: string
  asset: string
  state: MarketplaceOrderState
  checkoutUrl?: string
  externalOrderId?: string
  externalOrderStatus?: string
  paidAt?: string
  submittedAt?: string
  lines: BasketLine[]
  delivery?: DeliverySelection
  meta?: Record<string, unknown>
}

export type MarketplaceTransaction = {
  txHash?: string
  chainId?: number
}

export type MarketplacePaymentObservation = {
  entitled: boolean
  reason?: string
  order?: Record<string, unknown> | null
  transaction?: MarketplaceTransaction | null
}

export type MarketplaceSessionSnapshot = {
  entitlementActive: boolean
  marketplaceOrderId?: string
  checkoutUrl?: string
  submittedToMerchant: boolean
  externalOrderId?: string
  reason?: string
  transaction?: MarketplaceTransaction | null
}

export type MarketplaceStatusPhase =
  | "inactive"
  | "paid_without_order_context"
  | "paid_pending_submission"
  | "paid_submitted"

export type MarketplaceStatusDecision =
  | { kind: "inactive"; reason?: string }
  | { kind: "paid_without_order_context" }
  | { kind: "fetch_order_status"; marketplaceOrderId: string }
  | { kind: "paid_pending_submission" }
  | { kind: "paid_submitted" }

export type MarketplaceSessionState = {
  merchantSlug?: string
  resource?: string
  plan?: string
  marketplaceOrderId?: string
  checkoutUrl?: string
  shippingDate?: string
  deliveryAddress?: Record<string, unknown>
  deliveryNote?: string
  phone?: string
}

export type MarketplaceControlIntent =
  | "browse"
  | "checkout"
  | "status"
  | "confirm"
  | "cancel"

export type GuardSubjectRef =
  | { id: string }
  | { type: string; external_id: string }

export type MarketplaceHttpClientArgs = {
  baseUrl: string
  tenantToken: string
  fetchImpl?: typeof fetch
}

export type MarketplaceOrderIntentResponse = {
  ok?: boolean
  order?: Record<string, unknown>
  checkout_url?: string
  [key: string]: unknown
}

export interface MarketplaceAgentBackend {
  queryCatalog(args: CatalogQueryContext): Promise<CatalogQueryResult>
  createMarketplaceOrder(args: {
    merchantSlug: string
    protocolSubjectHeader: string
    channel: MarketplaceChannel
    localOrderId: string
    amountCents: number
    currency: string
    asset: string
    lines: BasketLine[]
    delivery?: DeliverySelection
    meta?: Record<string, unknown>
  }): Promise<{ valuyaOrderId: string; checkoutUrl?: string }>
  createCheckoutLink(args: {
    protocolSubjectHeader: string
    orderId: string
  }): Promise<{ checkoutUrl: string }>
  getMarketplaceOrder(args: {
    protocolSubjectHeader: string
    orderId: string
  }): Promise<Record<string, unknown>>
}

export function createValuyaMarketplaceHttpClient(args: MarketplaceHttpClientArgs) {
  const baseUrl = String(args.baseUrl || "").trim().replace(/\/+$/, "")
  const tenantToken = String(args.tenantToken || "").trim()
  const fetchImpl = args.fetchImpl || fetch
  if (!baseUrl) throw new Error("valuya_base_required")
  if (!tenantToken) throw new Error("valuya_tenant_token_required")

  return {
    async createMarketplaceOrder(args: {
      guardSubject: GuardSubjectRef
      protocolSubjectHeader: string
      productId: number
      merchantSlug: string
      channel: MarketplaceChannel
      resource: string
      plan: string
      amountCents: number
      currency: string
      asset: string
      cart: unknown
      localOrderId: string
      issueCheckoutToken?: boolean
    }): Promise<MarketplaceOrderIntentResponse> {
      const protocolSubjectHeader = requireNonEmpty(
        args.protocolSubjectHeader,
        "marketplace_protocol_subject_missing_fail_safe",
      )
      const productId = normalizePositiveInt(args.productId)
      if (!productId) throw new Error("marketplace_product_id_missing_fail_safe")
      const resource = requireNonEmpty(args.resource, "marketplace_resource_missing_fail_safe")
      const plan = requireNonEmpty(args.plan, "marketplace_plan_missing_fail_safe")
      const amountCents = normalizePositiveInt(args.amountCents)
      if (!amountCents) throw new Error("marketplace_amount_missing_fail_safe")
      const guardSubject = normalizeGuardSubject(args.guardSubject)

      const response = await fetchImpl(`${baseUrl}/api/marketplace/orders`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${tenantToken}`,
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

      const body = await safeParseJson(response)
      const record = asRecord(body) || {}
      if (!response.ok || record.ok === false) {
        throw new Error(
          `marketplace_order_intent_failed:${response.status}:${JSON.stringify(body).slice(0, 300)}`,
        )
      }
      return record as MarketplaceOrderIntentResponse
    },

    async getMarketplaceOrder(args: {
      protocolSubjectHeader: string
      orderId: string
    }): Promise<Record<string, unknown>> {
      const orderId = requireNonEmpty(args.orderId, "marketplace_order_id_required")
      const protocolSubjectHeader = requireNonEmpty(
        args.protocolSubjectHeader,
        "marketplace_protocol_subject_missing_fail_safe",
      )
      const response = await fetchImpl(
        `${baseUrl}/api/marketplace/orders/${encodeURIComponent(orderId)}`,
        {
          method: "GET",
          headers: {
            Authorization: `Bearer ${tenantToken}`,
            Accept: "application/json",
            "X-Valuya-Subject-Id": protocolSubjectHeader,
          },
        },
      )
      const body = await safeParseJson(response)
      const record = asRecord(body) || {}
      if (!response.ok || record.ok === false) {
        throw new Error(
          `marketplace_order_get_failed:${response.status}:${JSON.stringify(body).slice(0, 300)}`,
        )
      }
      return record
    },

    async createCheckoutLink(args: {
      protocolSubjectHeader: string
      orderId: string
    }): Promise<{ ok?: boolean; checkout_url?: string }> {
      const orderId = requireNonEmpty(args.orderId, "marketplace_order_id_required")
      const protocolSubjectHeader = requireNonEmpty(
        args.protocolSubjectHeader,
        "marketplace_protocol_subject_missing_fail_safe",
      )
      const response = await fetchImpl(
        `${baseUrl}/api/marketplace/orders/${encodeURIComponent(orderId)}/checkout-link`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${tenantToken}`,
            "Content-Type": "application/json",
            Accept: "application/json",
            "X-Valuya-Subject-Id": protocolSubjectHeader,
          },
          body: JSON.stringify({}),
        },
      )
      const body = await safeParseJson(response)
      const record = asRecord(body) || {}
      if (!response.ok || record.ok === false) {
        throw new Error(
          `marketplace_checkout_link_failed:${response.status}:${JSON.stringify(body).slice(0, 300)}`,
        )
      }
      return record as { ok?: boolean; checkout_url?: string }
    },
  }
}

export function formatMoney(cents: number, currency: string): string {
  return new Intl.NumberFormat("de-DE", {
    style: "currency",
    currency: currency || "EUR",
  }).format(cents / 100)
}

export function buildPolygonScanTxUrl(txHash: string, chainId?: number): string {
  if (chainId === 80002) {
    return `https://amoy.polygonscan.com/tx/${txHash}`
  }
  return `https://polygonscan.com/tx/${txHash}`
}

export function readMarketplaceTransaction(value: unknown): MarketplaceTransaction | null {
  const record = asRecord(value)
  if (!record) return null
  const payment = asRecord(record.payment)
  const order = asRecord(record.order)
  const txHash =
    readString(record.tx_hash) ||
    readString(record.txHash) ||
    readString(payment?.tx_hash) ||
    readString(payment?.txHash) ||
    readString(order?.tx_hash) ||
    readString(order?.txHash)
  const chainId =
    readNumber(record.chain_id) ??
    readNumber(record.chainId) ??
    readNumber(payment?.chain_id) ??
    readNumber(payment?.chainId) ??
    readNumber(order?.chain_id) ??
    readNumber(order?.chainId)
  if (!txHash && typeof chainId !== "number") return null
  return {
    ...(txHash ? { txHash } : {}),
    ...(typeof chainId === "number" ? { chainId } : {}),
  }
}

export function buildTransactionLines(args: {
  transaction: MarketplaceTransaction | null
  language?: "de" | "en"
}): string[] {
  const language = args.language || "de"
  const tx = args.transaction
  if (!tx?.txHash) return []
  return [
    language === "de"
      ? typeof tx.chainId === "number"
        ? `On-chain Transaktion: ${tx.txHash} (Chain ${tx.chainId})`
        : `On-chain Transaktion: ${tx.txHash}`
      : typeof tx.chainId === "number"
        ? `On-chain transaction: ${tx.txHash} (Chain ${tx.chainId})`
        : `On-chain transaction: ${tx.txHash}`,
    `Explorer: ${buildPolygonScanTxUrl(tx.txHash, tx.chainId)}`,
  ]
}

export function buildPaymentConfirmedReply(args: {
  transaction?: MarketplaceTransaction | null
  submittedToMerchant: boolean
  externalOrderId?: string
  language?: "de" | "en"
}): string {
  const language = args.language || "de"
  const txLines = buildTransactionLines({
    transaction: args.transaction || null,
    language,
  })

  if (language === "en") {
    return [
      "Paid.",
      ...(txLines.length > 0 ? txLines : ["Marketplace payment confirmed."]),
      args.submittedToMerchant
        ? "The order has been handed off to the merchant backend."
        : "The order has not yet been handed off to the merchant backend.",
      args.externalOrderId ? `External order id: ${args.externalOrderId}` : null,
      args.submittedToMerchant
        ? "Email/CSV delivery was triggered."
        : "Email/CSV delivery was not triggered yet.",
    ].filter(Boolean).join("\n")
  }

  return [
    "✓ Bezahlt.",
    ...(txLines.length > 0 ? txLines : ["Marketplace-Zahlung bestaetigt."]),
    args.submittedToMerchant
      ? "Die Bestellung wurde an das Merchant-Backend uebergeben."
      : "Die Bestellung wurde noch nicht an das Merchant-Backend uebergeben.",
    args.externalOrderId ? `Externe Bestellnummer: ${args.externalOrderId}` : null,
    args.submittedToMerchant
      ? "E-Mail/CSV Versand wurde ausgeloest."
      : "E-Mail/CSV Versand wurde noch nicht ausgeloest.",
  ].filter(Boolean).join("\n")
}

export function buildMarketplaceSessionSnapshot(args: {
  entitlementActive: boolean
  reason?: string
  marketplaceOrderId?: string
  checkoutUrl?: string
  externalOrderId?: string
  submittedToMerchant?: boolean
  marketplaceOrder?: unknown
}): MarketplaceSessionSnapshot {
  const externalOrderId = readString(args.externalOrderId)
  const submittedToMerchant = args.submittedToMerchant === true || Boolean(externalOrderId)
  return {
    entitlementActive: args.entitlementActive === true,
    ...(readString(args.reason) ? { reason: readString(args.reason) } : {}),
    ...(readString(args.marketplaceOrderId) ? { marketplaceOrderId: readString(args.marketplaceOrderId) } : {}),
    ...(readString(args.checkoutUrl) ? { checkoutUrl: readString(args.checkoutUrl) } : {}),
    submittedToMerchant,
    ...(externalOrderId ? { externalOrderId } : {}),
    transaction: readMarketplaceTransaction(args.marketplaceOrder),
  }
}

export function deriveMarketplaceStatusPhase(
  snapshot: MarketplaceSessionSnapshot,
): MarketplaceStatusPhase {
  if (!snapshot.entitlementActive) return "inactive"
  if (!snapshot.marketplaceOrderId) return "paid_without_order_context"
  if (snapshot.submittedToMerchant) return "paid_submitted"
  return "paid_pending_submission"
}

export function decideMarketplaceStatus(args: {
  snapshot: MarketplaceSessionSnapshot
  hasMarketplaceOrderStatus: boolean
}): MarketplaceStatusDecision {
  const phase = deriveMarketplaceStatusPhase(args.snapshot)
  if (phase === "inactive") {
    return {
      kind: "inactive",
      ...(args.snapshot.reason ? { reason: args.snapshot.reason } : {}),
    }
  }
  if (phase === "paid_without_order_context") {
    return { kind: "paid_without_order_context" }
  }
  if (!args.hasMarketplaceOrderStatus && args.snapshot.marketplaceOrderId) {
    return {
      kind: "fetch_order_status",
      marketplaceOrderId: args.snapshot.marketplaceOrderId,
    }
  }
  return phase === "paid_submitted"
    ? { kind: "paid_submitted" }
    : { kind: "paid_pending_submission" }
}

export function readMarketplaceSessionState(metadata: Record<string, unknown> | null | undefined): MarketplaceSessionState {
  const record = asRecord(metadata) || {}
  const nested = asRecord(record.marketplaceSession) || {}
  const state: MarketplaceSessionState = {
    merchantSlug: readString(nested.merchantSlug ?? record.merchantSlug),
    resource: readString(nested.resource ?? record.resource),
    plan: readString(nested.plan ?? record.plan),
    marketplaceOrderId: readString(
      nested.marketplaceOrderId
      ?? record.marketplaceOrderId
      ?? record.currentMarketplaceOrderId,
    ),
    checkoutUrl: readString(
      nested.checkoutUrl
      ?? record.checkoutUrl
      ?? record.currentCheckoutUrl,
    ),
    shippingDate: readString(nested.shippingDate ?? record.shippingDate),
    deliveryAddress: asRecord(nested.deliveryAddress ?? record.deliveryAddress) || undefined,
    deliveryNote: readString(nested.deliveryNote ?? record.deliveryNote),
    phone: readString(nested.phone ?? record.phone),
  }
  return Object.fromEntries(
    Object.entries(state).filter(([, value]) => value !== undefined),
  ) as MarketplaceSessionState
}

export function writeMarketplaceSessionState(args: {
  metadata?: Record<string, unknown>
  session: MarketplaceSessionState
}): Record<string, unknown> {
  const base = { ...(args.metadata || {}) }
  const current = readMarketplaceSessionState(base)
  const next = {
    ...current,
    ...Object.fromEntries(
      Object.entries(args.session).filter(([, value]) => value !== undefined),
    ),
  }
  return {
    ...base,
    marketplaceSession: next,
    ...(next.merchantSlug ? { merchantSlug: next.merchantSlug } : {}),
    ...(next.resource ? { resource: next.resource } : {}),
    ...(next.plan ? { plan: next.plan } : {}),
    ...(next.marketplaceOrderId ? { currentMarketplaceOrderId: next.marketplaceOrderId } : {}),
    ...(next.checkoutUrl ? { currentCheckoutUrl: next.checkoutUrl } : {}),
    ...(next.shippingDate ? { shippingDate: next.shippingDate } : {}),
    ...(next.deliveryAddress ? { deliveryAddress: next.deliveryAddress } : {}),
    ...(next.deliveryNote ? { deliveryNote: next.deliveryNote } : {}),
    ...(next.phone ? { phone: next.phone } : {}),
  }
}

export function buildCheckoutPreparedReply(args: {
  amountCents?: number
  currency?: string
  itemCount?: number
  checkoutUrl?: string
  language?: "de" | "en"
}): string {
  const language = args.language || "de"
  if (language === "en") {
    return [
      typeof args.amountCents === "number"
        ? `I prepared your Valuya checkout for ${formatMoney(args.amountCents, args.currency || "EUR")}.`
        : "I prepared your Valuya checkout.",
      args.itemCount ? `Cart items: ${args.itemCount}` : null,
      args.checkoutUrl ? `Checkout link: ${args.checkoutUrl}` : null,
      "",
      "After you pay, send 'status'.",
    ].filter(Boolean).join("\n")
  }

  return [
    typeof args.amountCents === "number"
      ? `Ich habe deinen Valuya-Checkout fuer ${formatMoney(args.amountCents, args.currency || "EUR")} vorbereitet.`
      : "Ich habe deinen Valuya-Checkout vorbereitet.",
    args.itemCount ? `Warenkorbpositionen: ${args.itemCount}` : null,
    args.checkoutUrl ? `Zahlungslink: ${args.checkoutUrl}` : null,
    "",
    "Nachdem du bezahlt hast, schreibe 'status'.",
  ].filter(Boolean).join("\n")
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? value as Record<string, unknown> : null
}

function requireNonEmpty(value: unknown, error: string): string {
  const result = readString(value)
  if (!result) throw new Error(error)
  return result
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined
}

function readNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return Math.trunc(value)
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return Math.trunc(parsed)
  }
  return undefined
}

function normalizePositiveInt(value: unknown): number | null {
  const parsed = readNumber(value)
  return typeof parsed === "number" && parsed > 0 ? parsed : null
}

function normalizeGuardSubject(value: GuardSubjectRef): GuardSubjectRef {
  if ("id" in value) {
    const id = requireNonEmpty(value.id, "marketplace_guard_subject_missing_fail_safe")
    return { id }
  }
  const type = requireNonEmpty(value.type, "marketplace_guard_subject_missing_fail_safe")
  const externalId = requireNonEmpty(value.external_id, "marketplace_guard_subject_missing_fail_safe")
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
