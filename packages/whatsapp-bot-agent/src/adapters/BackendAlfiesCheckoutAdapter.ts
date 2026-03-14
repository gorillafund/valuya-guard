import type {
  AlfiesCartLine,
  AlfiesCheckoutPort,
  AlfiesDeliveryAddress,
  AlfiesResolvedAddress,
  AlfiesShippingOption,
} from "../ports/AlfiesCheckoutPort.js"

export class BackendAlfiesCheckoutAdapter implements AlfiesCheckoutPort {
  private readonly baseUrl: string
  private readonly token: string
  private readonly resource: string
  private readonly plan: string
  private readonly source: string
  private readonly fetchImpl: typeof fetch

  constructor(args: {
    baseUrl: string
    token: string
    resource: string
    plan: string
    source?: string
    fetchImpl?: typeof fetch
  }) {
    this.baseUrl = String(args.baseUrl || "").trim().replace(/\/+$/, "")
    this.token = String(args.token || "").trim()
    this.resource = String(args.resource || "").trim()
    this.plan = String(args.plan || "").trim() || "standard"
    this.source = String(args.source || "whatsapp").trim() || "whatsapp"
    this.fetchImpl = args.fetchImpl || fetch
    if (!this.baseUrl) throw new Error("alfies_backend_base_url_required")
    if (!this.token) throw new Error("alfies_backend_token_required")
  }

  async priceCart(args: {
    lines: AlfiesCartLine[]
  }): Promise<{ amountCents: number; currency: string }> {
    const amountCents = args.lines.reduce((sum, line) => {
      const unitPrice = typeof line.unitPriceCents === "number" && Number.isFinite(line.unitPriceCents)
        ? Math.trunc(line.unitPriceCents)
        : 0
      return sum + Math.max(0, unitPrice) * Math.max(0, Math.trunc(line.qty || 0))
    }, 0)
    return { amountCents, currency: "EUR" }
  }

  async prepareCheckout(args: {
    localOrderId: string
    protocolSubjectHeader: string
    lines: AlfiesCartLine[]
    deliveryAddress: AlfiesDeliveryAddress
    shippingDate: string
    deliveryNote?: string
    phone?: string
  }): Promise<{
    ok: true
    basketTotalCents: number
    currency: string
    shippingAddressId?: number
    shippingAddress: AlfiesResolvedAddress
    shippingOptions: AlfiesShippingOption[]
    suggestedShippingOption?: AlfiesShippingOption
    preview?: Record<string, unknown>
  }> {
    const response = await this.fetchImpl(`${this.baseUrl}/api/agent/orders/prepare-checkout`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.token}`,
        Accept: "application/json",
        "Content-Type": "application/json",
        "X-Valuya-Subject": args.protocolSubjectHeader,
        "Idempotency-Key": `alfies-prepare:${args.localOrderId}:v1`,
      },
      body: JSON.stringify({
        order_id: args.localOrderId,
        source: this.source,
        resource: this.resource,
        plan: this.plan,
        shipping_date: args.shippingDate,
        phone: args.phone || args.deliveryAddress.phone,
        delivery_note: args.deliveryNote || args.deliveryAddress.notes,
        delivery_address: {
          line1: args.deliveryAddress.line1,
          house: args.deliveryAddress.house,
          postcode: args.deliveryAddress.postcode,
          city: args.deliveryAddress.city,
          latitude: args.deliveryAddress.latitude,
          longitude: args.deliveryAddress.longitude,
          ...(args.deliveryAddress.phone ? { phone: args.deliveryAddress.phone } : {}),
          ...(args.deliveryAddress.notes ? { notes: args.deliveryAddress.notes } : {}),
        },
        products: args.lines.map((line) => ({
          ...(typeof line.productId === "number" ? { product_id: Math.trunc(line.productId) } : {}),
          sku: line.sku,
          name: line.name,
          qty: Math.trunc(line.qty),
          ...(typeof line.unitPriceCents === "number" ? { unit_price_cents: Math.trunc(line.unitPriceCents) } : {}),
        })),
        meta: {
          actor_type: "agent",
          channel: this.source,
        },
      }),
    })
    const body = await safeParseJson(response)
    if (!response.ok) {
      throw new Error(`alfies_prepare_checkout_failed:${response.status}:${JSON.stringify(body).slice(0, 300)}`)
    }
    const record = body && typeof body === "object" ? body as Record<string, unknown> : {}
    const shippingOptions = readShippingOptions(record.shipping_options)
    const suggestedShippingOption = readShippingOption(record.suggested_shipping_option)
    return {
      ok: true,
      basketTotalCents: readNumber(record.basket_total_cents) || 0,
      currency: readString(record.currency) || "EUR",
      shippingAddressId: readNumber(record.shipping_address_id),
      shippingAddress: readResolvedAddress(record.shipping_address) || {
        ...args.deliveryAddress,
      },
      shippingOptions,
      ...(suggestedShippingOption ? { suggestedShippingOption } : {}),
      ...(record.preview && typeof record.preview === "object" ? { preview: record.preview as Record<string, unknown> } : {}),
    }
  }

  async submitPaidOrder(args: {
    localOrderId: string
    protocolSubjectHeader: string
    paymentReference: string
    lines: AlfiesCartLine[]
    deliveryAddress: AlfiesDeliveryAddress
    billingAddress?: AlfiesDeliveryAddress
    shippingOption: AlfiesShippingOption
    expectedTotalCents: number
  }): Promise<{
    ok: true
    externalOrderId: string
    externalOrderStatus?: string
    submittedAt: string
  }> {
    const response = await this.fetchImpl(`${this.baseUrl}/api/agent/orders/submit-paid`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.token}`,
        Accept: "application/json",
        "Content-Type": "application/json",
        "X-Valuya-Subject": args.protocolSubjectHeader,
        "Idempotency-Key": `alfies-submit:${args.localOrderId}:${args.paymentReference}`,
      },
      body: JSON.stringify({
        order_id: args.localOrderId,
        payment_reference: args.paymentReference,
        source: this.source,
        resource: this.resource,
        plan: this.plan,
        expected_total_cents: Math.trunc(args.expectedTotalCents),
        delivery_address: args.deliveryAddress,
        ...(args.billingAddress ? { billing_address: args.billingAddress } : {}),
        shipping_option: {
          code: args.shippingOption.code,
          ...(args.shippingOption.date ? { date: args.shippingOption.date } : {}),
          ...(args.shippingOption.name ? { name: args.shippingOption.name } : {}),
          ...(typeof args.shippingOption.shippingChargeCents === "number"
            ? { shipping_charge_cents: Math.trunc(args.shippingOption.shippingChargeCents) }
            : {}),
          ...(args.shippingOption.currency ? { currency: args.shippingOption.currency } : {}),
          ...(args.shippingOption.raw ? { raw: args.shippingOption.raw } : {}),
        },
        products: args.lines.map((line) => ({
          ...(typeof line.productId === "number" ? { product_id: Math.trunc(line.productId) } : {}),
          sku: line.sku,
          name: line.name,
          qty: Math.trunc(line.qty),
          ...(typeof line.unitPriceCents === "number" ? { unit_price_cents: Math.trunc(line.unitPriceCents) } : {}),
        })),
        meta: {
          actor_type: "agent",
          channel: this.source,
        },
      }),
    })
    const body = await safeParseJson(response)
    if (!response.ok) {
      if (response.status === 404 && isMissingRouteResponse(body)) {
        return this.submitLegacyPaidOrder(args)
      }
      throw new Error(`alfies_submit_paid_failed:${response.status}:${JSON.stringify(body).slice(0, 300)}`)
    }
    const record = body && typeof body === "object" ? body as Record<string, unknown> : {}
    const externalOrderId = readString(record.order_id) || readString(record.external_order_id) || args.localOrderId
    return {
      ok: true,
      externalOrderId,
      ...(readString(record.status) ? { externalOrderStatus: readString(record.status) } : {}),
      submittedAt: readString(record.submitted_at) || new Date().toISOString(),
    }
  }

  async dispatchOrder(args: {
    localOrderId: string
    lines: AlfiesCartLine[]
    protocolSubjectHeader: string
  }): Promise<{ ok: true; externalOrderId?: string }> {
    const result = await this.submitPaidOrder({
      localOrderId: args.localOrderId,
      protocolSubjectHeader: args.protocolSubjectHeader,
      paymentReference: `legacy-dispatch:${args.localOrderId}`,
      lines: args.lines,
      deliveryAddress: {
        line1: "Kaiserstrasse",
        house: "8/7a",
        postcode: "1070",
        city: "Wien",
        latitude: 48.2036,
        longitude: 16.3492,
      },
      shippingOption: {
        code: "legacy_dispatch",
        name: "Legacy dispatch fallback",
      },
      expectedTotalCents: args.lines.reduce((sum, line) => sum + (Math.trunc(line.unitPriceCents || 0) * Math.trunc(line.qty || 0)), 0),
    })
    return { ok: true, externalOrderId: result.externalOrderId }
  }

  private async submitLegacyPaidOrder(args: {
    localOrderId: string
    protocolSubjectHeader: string
    paymentReference: string
    lines: AlfiesCartLine[]
    deliveryAddress: AlfiesDeliveryAddress
    billingAddress?: AlfiesDeliveryAddress
    shippingOption: AlfiesShippingOption
    expectedTotalCents: number
  }): Promise<{
    ok: true
    externalOrderId: string
    externalOrderStatus?: string
    submittedAt: string
  }> {
    const response = await this.fetchImpl(`${this.baseUrl}/api/agent/orders`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.token}`,
        Accept: "application/json",
        "Content-Type": "application/json",
        "X-Valuya-Subject": args.protocolSubjectHeader,
        "Idempotency-Key": `alfies-submit:${args.localOrderId}:${args.paymentReference}`,
      },
      body: JSON.stringify({
        order_id: args.localOrderId,
        source: this.source,
        customer_number: "89733",
        resource: this.resource,
        plan: this.plan,
        delivery: {
          type: "sofort",
        },
        delivery_address: {
          street: [args.deliveryAddress.line1, args.deliveryAddress.house].filter(Boolean).join(" ").trim(),
          postal_code: args.deliveryAddress.postcode,
          city: args.deliveryAddress.city,
          country: "AT",
        },
        products: args.lines.map((line) => ({
          sku: line.sku,
          name: line.name,
          qty: Math.trunc(line.qty),
          ...(typeof line.unitPriceCents === "number" ? { unit_price_cents: Math.trunc(line.unitPriceCents) } : {}),
        })),
        meta: {
          total_cents: Math.trunc(args.expectedTotalCents),
          actor_type: "agent",
          channel: this.source,
          payment_reference: args.paymentReference,
          shipping_option_code: args.shippingOption.code,
        },
      }),
    })
    const body = await safeParseJson(response)
    if (!response.ok) {
      throw new Error(`alfies_submit_paid_failed:${response.status}:${JSON.stringify(body).slice(0, 300)}`)
    }
    const record = body && typeof body === "object" ? body as Record<string, unknown> : {}
    const externalOrderId = readString(record.order_id) || readString(record.external_order_id) || args.localOrderId
    return {
      ok: true,
      externalOrderId,
      ...(readString(record.status) ? { externalOrderStatus: readString(record.status) } : {}),
      submittedAt: readString(record.submitted_at) || new Date().toISOString(),
    }
  }
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

function isMissingRouteResponse(value: unknown): boolean {
  if (!value || typeof value !== "object") return false
  const record = value as Record<string, unknown>
  return readString(record.error) === "not_found"
    || /could not be found/i.test(readString(record.message) || "")
}

function readResolvedAddress(value: unknown): AlfiesResolvedAddress | undefined {
  if (!value || typeof value !== "object") return undefined
  const record = value as Record<string, unknown>
  const line1 = readString(record.line1)
  const house = readString(record.house)
  const postcode = readString(record.postcode)
  const city = readString(record.city)
  const latitude = readNumber(record.latitude)
  const longitude = readNumber(record.longitude)
  if (!line1 || !house || !postcode || !city || typeof latitude !== "number" || typeof longitude !== "number") {
    return undefined
  }
  return {
    line1,
    house,
    postcode,
    city,
    latitude,
    longitude,
    ...(readString(record.phone) ? { phone: readString(record.phone) } : {}),
    ...(readString(record.notes) ? { notes: readString(record.notes) } : {}),
    ...(typeof readNumber(record.id) === "number" ? { id: readNumber(record.id) } : {}),
    ...(readString(record.shippingMethod) ? { shippingMethod: readString(record.shippingMethod) } : {}),
    ...(readString(record.warehouseCode) ? { warehouseCode: readString(record.warehouseCode) } : {}),
  }
}

function readShippingOptions(value: unknown): AlfiesShippingOption[] {
  if (!Array.isArray(value)) return []
  return value
    .map((entry) => readShippingOption(entry))
    .filter((entry): entry is AlfiesShippingOption => Boolean(entry))
}

function readShippingOption(value: unknown): AlfiesShippingOption | undefined {
  if (!value || typeof value !== "object") return undefined
  const record = value as Record<string, unknown>
  const code = readString(record.code)
  if (!code) return undefined
  return {
    code,
    ...(readString(record.date) ? { date: readString(record.date) } : {}),
    ...(readString(record.name) ? { name: readString(record.name) } : {}),
    ...(typeof readNumber(record.shipping_charge_cents ?? record.shippingChargeCents) === "number"
      ? { shippingChargeCents: readNumber(record.shipping_charge_cents ?? record.shippingChargeCents) }
      : {}),
    ...(readString(record.currency) ? { currency: readString(record.currency) } : {}),
    raw: record,
  }
}
