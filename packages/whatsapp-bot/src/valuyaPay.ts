import type { AgentConfig, AgentSubject } from "@valuya/agent"
import {
  apiJson,
  createProvider,
  makeEthersSigner,
  purchase,
  sendErc20Transfer,
} from "@valuya/agent"
import type { CartState, RecipeState } from "./stateStore.js"

export type WhoamiResponse = {
  ok?: boolean
  agent?: {
    token_id?: string
    wallet_address?: string | null
    scopes?: string[]
  }
  principal?: {
    subject?: { type?: string; id?: string } | null
  } | null
  tenant?: {
    id?: string | number
    slug?: string | null
  } | null
}

type EntitlementDecision = {
  active: boolean
  reason?: string
  required?: { type: string; plan?: string; [k: string]: unknown }
}

export type PaymentSuccess = {
  ok: true
  whoami: WhoamiResponse
  txHash?: string
  chainId?: number
}

export type PaymentRequired = {
  ok: false
  whoami: WhoamiResponse
  reason: string
}

export type OrderPayload = {
  order_id: string
  source: "whatsapp"
  customer_number: "89733"
  resource: string
  plan: string
  delivery: { type: "sofort" }
  delivery_address: {
    street: "Kaiserstrasse 8/7a"
    postal_code: "1070"
    city: "Wien"
    country: "AT"
  }
  products: Array<{ sku: string; name: string; qty: number; unit_price_cents?: number }>
  meta: {
    recipe_title?: string
    total_cents?: number
    currency?: string
  }
}

export class ValuyaPayClient {
  private readonly cfg: AgentConfig
  private readonly backendBaseUrl: string
  private readonly backendToken: string
  private readonly resource: string
  private readonly plan: string
  private readonly privateKey?: string
  private readonly rpcUrl?: string

  constructor(args: {
    cfg: AgentConfig
    backendBaseUrl: string
    backendToken: string
    resource: string
    plan: string
    privateKey?: string
    rpcUrl?: string
  }) {
    this.cfg = args.cfg
    this.backendBaseUrl = args.backendBaseUrl.replace(/\/+$/, "")
    this.backendToken = args.backendToken
    this.resource = args.resource
    this.plan = args.plan
    this.privateKey = args.privateKey
    this.rpcUrl = args.rpcUrl
  }

  async whoami(subjectId: string): Promise<WhoamiResponse> {
    const canonicalSubjectId = normalizeCanonicalSubjectId(subjectId)
    const subject = parseSubjectId(canonicalSubjectId)
    return apiJson<WhoamiResponse>({
      cfg: this.cfg,
      method: "GET",
      path: "/api/v2/agent/whoami",
      headers: {
        Accept: "application/json",
        "X-Valuya-Subject": canonicalSubjectId,
        "X-Valuya-Subject-Id": canonicalSubjectId,
        "X-Valuya-Subject-Type": subject.type,
        "X-Valuya-Subject-Id-Raw": subject.id,
      },
    })
  }

  async ensurePaid(args: {
    subjectId: string
    orderId: string
    amountCents?: number
    currency?: string
  }): Promise<PaymentSuccess | PaymentRequired> {
    const paymentSubject = await this.resolvePaymentSubject(args.subjectId)
    const canonicalSubjectId = normalizeCanonicalSubjectId(
      `${paymentSubject.type}:${paymentSubject.id}`,
    )
    const subject = parseSubjectId(canonicalSubjectId)
    const who = await this.whoami(canonicalSubjectId)

    const currentEntitlement = await this.getEntitlement(subject)
    if (currentEntitlement.active) {
      return { ok: true, whoami: who }
    }

    const required = currentEntitlement.required || { type: "subscription", plan: this.plan }
    if (!this.privateKey || !this.rpcUrl) {
      return {
        ok: false,
        whoami: who,
        reason: "agent_auto_payment_not_configured",
      }
    }

    try {
      const signer = makeEthersSigner(this.privateKey, createProvider(this.rpcUrl))
      const purchaseResult = await purchaseWithRetry({
        cfg: this.cfg,
        signer,
        subject,
        principal: subject,
        resource: this.resource,
        plan: this.plan,
        required: required as any,
        // TODO: payment in Valuya is plan/resource-priced; order total is passed as metadata.
        ...(typeof args.amountCents === "number" && args.amountCents > 0
          ? { quantity_requested: 1 }
          : {}),
        sendTx: async (payment: any) => {
          if (payment.method !== "onchain") {
            throw new Error(`unsupported_payment_method:${payment.method}`)
          }
          return sendErc20Transfer({ signer, payment })
        },
      })

      const after = await this.getEntitlement(subject)
      if (after.active) {
        const chainId =
          purchaseResult.session.payment &&
          typeof (purchaseResult.session.payment as any).chain_id === "number"
            ? Number((purchaseResult.session.payment as any).chain_id)
            : undefined

        return {
          ok: true,
          whoami: who,
          txHash: purchaseResult.tx_hash,
          chainId,
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return {
        ok: false,
        whoami: who,
        reason: `agent_auto_payment_failed:${message}`,
      }
    }

    return {
      ok: false,
      whoami: who,
      reason: "entitlement_not_active_after_purchase",
    }
  }

  async submitOrder(args: {
    subjectId: string
    orderId: string
    cart?: CartState
    recipe?: RecipeState
  }): Promise<{
    orderPayload: OrderPayload
    responseBody: unknown
  }> {
    const paymentSubject = await this.resolvePaymentSubject(args.subjectId)
    const canonicalSubjectId = normalizeCanonicalSubjectId(
      `${paymentSubject.type}:${paymentSubject.id}`,
    )
    const subject = parseSubjectId(canonicalSubjectId)
    const endpoint = `${this.backendBaseUrl}/api/agent/orders`
    const payload = buildOrderPayload({
      orderId: args.orderId,
      resource: this.resource,
      plan: this.plan,
      cart: args.cart,
      recipe: args.recipe,
    })

    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Authorization: `Bearer ${this.backendToken}`,
        "X-Valuya-Subject": canonicalSubjectId,
        "X-Valuya-Subject-Id": canonicalSubjectId,
        "X-Valuya-Subject-Type": subject.type,
        "X-Valuya-Subject-Id-Raw": subject.id,
        "Idempotency-Key": `order-email:${args.orderId}`,
      },
      body: JSON.stringify(payload),
    })

    const responseBody = await safeParseJson(response)
    if (!response.ok) {
      throw new Error(
        `order_backend_http_${response.status}:${JSON.stringify(responseBody).slice(0, 300)}`,
      )
    }

    return { orderPayload: payload, responseBody }
  }

  private async getEntitlement(subject: AgentSubject): Promise<EntitlementDecision> {
    const subjectId = `${subject.type}:${subject.id}`
    return apiJson<EntitlementDecision>({
      cfg: this.cfg,
      method: "GET",
      path: `/api/v2/entitlements?plan=${encodeURIComponent(this.plan)}&resource=${encodeURIComponent(this.resource)}`,
      headers: {
        Accept: "application/json",
        "X-Valuya-Subject": subjectId,
        "X-Valuya-Subject-Id": subjectId,
        "X-Valuya-Subject-Type": subject.type,
        "X-Valuya-Subject-Id-Raw": subject.id,
      },
    })
  }

  private async resolvePaymentSubject(fallbackSubjectId: string): Promise<AgentSubject> {
    try {
      const who = await apiJson<WhoamiResponse>({
        cfg: this.cfg,
        method: "GET",
        path: "/api/v2/agent/whoami",
        headers: { Accept: "application/json" },
      })

      const type = String(who.principal?.subject?.type || "").trim()
      const id = String(who.principal?.subject?.id || "").trim()
      if (type && id) return { type, id }
    } catch {
      // fallback below
    }

    return parseSubjectId(normalizeCanonicalSubjectId(fallbackSubjectId))
  }
}

function normalizeCanonicalSubjectId(subjectId: string): string {
  const value = String(subjectId || "").trim()
  const idx = value.indexOf(":")
  if (idx <= 0 || idx === value.length - 1) {
    throw new Error("subject_invalid")
  }

  const type = value.slice(0, idx).trim()
  const rawId = value.slice(idx + 1).trim()
  if (!type || !rawId) throw new Error("subject_invalid")

  // WhatsApp identifiers are normalized to digits-only to avoid header validation issues.
  if (type === "whatsapp") {
    const normalized = rawId.replace(/^\+/, "").replace(/\s+/g, "").replace(/[^\d]/g, "")
    if (!normalized) throw new Error("subject_invalid")
    return `${type}:${normalized}`
  }

  return `${type}:${rawId}`
}

function parseSubjectId(subjectId: string): AgentSubject {
  const value = String(subjectId || "").trim()
  const idx = value.indexOf(":")
  if (idx <= 0 || idx === value.length - 1) {
    throw new Error("subject_invalid")
  }
  return {
    type: value.slice(0, idx),
    id: value.slice(idx + 1),
  }
}

function buildOrderPayload(args: {
  orderId: string
  resource: string
  plan: string
  cart?: CartState
  recipe?: RecipeState
}): OrderPayload {
  const products = mapProducts(args.cart?.items)
  const total = typeof args.cart?.total_cents === "number" ? Math.trunc(args.cart.total_cents) : undefined
  const currency = String(args.cart?.currency || "EUR").trim() || "EUR"

  return {
    order_id: args.orderId,
    source: "whatsapp",
    customer_number: "89733",
    resource: args.resource,
    plan: args.plan,
    delivery: { type: "sofort" },
    delivery_address: {
      street: "Kaiserstrasse 8/7a",
      postal_code: "1070",
      city: "Wien",
      country: "AT",
    },
    products,
    meta: {
      ...(args.recipe?.title ? { recipe_title: args.recipe.title } : {}),
      ...(typeof total === "number" ? { total_cents: total } : {}),
      currency,
    },
  }
}

function mapProducts(input: unknown): Array<{ sku: string; name: string; qty: number; unit_price_cents?: number }> {
  if (!Array.isArray(input)) return []
  const out: Array<{ sku: string; name: string; qty: number; unit_price_cents?: number }> = []

  for (const raw of input) {
    if (!raw || typeof raw !== "object") continue
    const item = raw as Record<string, unknown>
    const sku = String(item.sku ?? "").trim()
    const name = String(item.name ?? "").trim()
    if (!sku || !name) continue

    const qty = toInt(item.qty) ?? 1
    const unit = toInt(item.unit_price_cents)
    out.push({
      sku,
      name,
      qty,
      ...(typeof unit === "number" ? { unit_price_cents: unit } : {}),
    })
  }

  return out
}

function toInt(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return Math.trunc(value)
  if (typeof value === "string" && value.trim()) {
    const n = Number(value)
    if (Number.isFinite(n)) return Math.trunc(n)
  }
  return undefined
}

async function purchaseWithRetry(args: Parameters<typeof purchase>[0]): Promise<Awaited<ReturnType<typeof purchase>>> {
  const maxAttempts = 2
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await purchase(args as any)
    } catch (error) {
      if (attempt >= maxAttempts) throw error
      await sleep(300 * Math.pow(2, attempt - 1))
    }
  }
  throw new Error("agent_auto_payment_unreachable")
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
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
