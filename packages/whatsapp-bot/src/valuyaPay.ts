import type { AgentConfig, AgentSubject } from "@valuya/agent"
import { apiJson } from "@valuya/agent"
import type { CartState, RecipeState } from "./stateStore.js"

type LogFn = (event: string, fields: Record<string, unknown>) => void
type SleepFn = (ms: number) => Promise<void>

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
  valuyaOrderId?: string
  txHash?: string
  chainId?: number
}

export type PaymentRequired = {
  ok: false
  whoami: WhoamiResponse
  reason: string
  checkoutUrl?: string
  topupUrl?: string
  valuyaOrderId?: string
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
    actor_type?: string
    channel?: string
    subject_type?: string
    subject_external_id?: string
  }
}

export class ValuyaPayClient {
  private readonly cfg: AgentConfig
  private readonly backendBaseUrl: string
  private readonly backendToken: string
  private readonly resource: string
  private readonly plan: string
  private readonly marketplaceProductId: number
  private readonly marketplaceMerchantSlug: string
  private readonly log: LogFn
  private readonly entitlementPollDelaysMs: number[]
  private readonly sleepFn: SleepFn

  constructor(args: {
    cfg: AgentConfig
    backendBaseUrl: string
    backendToken: string
    resource: string
    plan: string
    marketplaceProductId: number
    marketplaceMerchantSlug?: string
    logger?: LogFn
    entitlementPollDelaysMs?: number[]
    sleepFn?: SleepFn
  }) {
    this.cfg = args.cfg
    this.backendBaseUrl = args.backendBaseUrl.replace(/\/+$/, "")
    this.backendToken = args.backendToken
    this.resource = args.resource
    this.plan = args.plan
    this.marketplaceProductId = Math.trunc(args.marketplaceProductId)
    this.marketplaceMerchantSlug = String(args.marketplaceMerchantSlug || "alfies").trim() || "alfies"
    this.log =
      args.logger ||
      ((event, fields) => {
        console.log(JSON.stringify({ level: "info", event, ...fields }))
      })
    this.entitlementPollDelaysMs = args.entitlementPollDelaysMs ?? [10_000, 20_000, 35_000, 60_000]
    this.sleepFn = args.sleepFn ?? sleep
  }

  async whoami(subject: AgentSubject): Promise<WhoamiResponse> {
    const canonicalSubjectId = normalizeCanonicalSubjectId(`${subject.type}:${subject.id}`)
    const canonicalSubject = parseSubjectId(canonicalSubjectId)
    return apiJson<WhoamiResponse>({
      cfg: this.cfg,
      method: "GET",
      path: "/api/v2/agent/whoami",
      headers: {
        Accept: "application/json",
        "X-Valuya-Subject": canonicalSubjectId,
        "X-Valuya-Subject-Id": canonicalSubjectId,
        "X-Valuya-Subject-Type": canonicalSubject.type,
        "X-Valuya-Subject-Id-Raw": canonicalSubject.id,
      },
    })
  }

  async ensurePaid(args: {
    subject: AgentSubject
    orderId: string
    amountCents?: number
    currency?: string
    actorType?: string
    channel?: string
    protocolSubjectHeader?: string
    guardSubjectId?: string
    guardSubjectType?: string
    guardSubjectExternalId?: string
    linkedWalletAddress?: string
    cart?: unknown
    recipe?: RecipeState
  }): Promise<PaymentSuccess | PaymentRequired> {
    const canonicalSubjectId = normalizeCanonicalSubjectId(`${args.subject.type}:${args.subject.id}`)
    const subject = parseSubjectId(canonicalSubjectId)
    const who = await this.whoami(subject)

    const protocolSubjectHeader = String(args.protocolSubjectHeader || canonicalSubjectId).trim()
    const guardSubjectId = String(args.guardSubjectId || "").trim()
    const guardSubjectType = String(args.guardSubjectType || "").trim()
    const guardSubjectExternalId = String(args.guardSubjectExternalId || "").trim()
    const linkedWalletAddress = normalizeWallet(args.linkedWalletAddress)
    const guardAgentWalletAddress = null
    const principal = resolveDelegatedPrincipal(who, protocolSubjectHeader)
    const normalizedCart = normalizeCartState(args.cart, args.amountCents, args.currency)
    let marketplaceOrderId: string | undefined

    if (!linkedWalletAddress) {
      this.log("valuya_wallet_selection_failed", {
        subjectHeader: protocolSubjectHeader,
        principal_subject_type: principal.type,
        principal_subject_id: principal.id,
        wallet_source: "legacy_env_signer_blocked",
        linked_privy_wallet_address: null,
        guard_agent_wallet_address: guardAgentWalletAddress,
        error: "linked_privy_wallet_missing_fail_safe",
      })
      return { ok: false, whoami: who, reason: "linked_wallet_missing_fail_safe" }
    }
    if (!guardSubjectId && (!guardSubjectType || !guardSubjectExternalId)) {
      this.log("valuya_wallet_selection_failed", {
        subjectHeader: protocolSubjectHeader,
        principal_subject_type: principal.type,
        principal_subject_id: principal.id,
        wallet_source: "linked_privy_wallet",
        linked_privy_wallet_address: linkedWalletAddress,
        guard_agent_wallet_address: guardAgentWalletAddress,
        error: "guard_subject_missing_fail_safe",
      })
      return { ok: false, whoami: who, reason: "guard_subject_missing_fail_safe" }
    }

    try {
      this.log("payment_trace", buildPaymentTrace({
        stage: "ensure_paid_start",
        localOrderId: args.orderId,
        protocolSubjectHeader,
        resource: this.resource,
        plan: this.plan,
        amountCents: normalizedCart?.total_cents,
        currency: normalizedCart?.currency || args.currency || "EUR",
        guardSubjectId,
        guardSubjectType,
        guardSubjectExternalId,
      }))

      const before = await this.getEntitlement(protocolSubjectHeader)
      this.log("payment_trace", buildPaymentTrace({
        stage: "entitlement_precheck",
        localOrderId: args.orderId,
        protocolSubjectHeader,
        resource: this.resource,
        plan: this.plan,
        amountCents: normalizedCart?.total_cents,
        currency: normalizedCart?.currency || args.currency || "EUR",
        guardSubjectId,
        guardSubjectType,
        guardSubjectExternalId,
        entitlementActive: before.active,
        entitlementReason: before.reason,
      }))
      if (before.active) {
        this.log("payment_decision", {
          order_id: args.orderId,
          action: "autopay_success",
          reason: "entitlement_already_active",
          subject_header: protocolSubjectHeader,
        })
        return { ok: true, whoami: who }
      }

      this.log("payment_flow_branch", {
        order_id: args.orderId,
        flow_branch: "delegated_guard_autopay_path",
        tenant: tokenPreview(this.cfg.tenant_token),
        subject_header: protocolSubjectHeader,
        resource: this.resource,
        plan: this.plan,
      })

      const marketplaceOrder = await this.createMarketplaceOrderForDelegatedPayment({
        orderId: args.orderId,
        protocolSubjectHeader,
        guardSubjectId,
        guardSubjectType,
        guardSubjectExternalId,
        amountCents: args.amountCents,
        currency: args.currency || "EUR",
        asset: "EURe",
        cart: normalizedCart,
      })
      marketplaceOrderId = marketplaceOrder.orderId
      this.log("payment_trace", buildPaymentTrace({
        stage: "marketplace_order_created",
        localOrderId: args.orderId,
        valuyaOrderId: marketplaceOrderId,
        protocolSubjectHeader,
        resource: this.resource,
        plan: this.plan,
        amountCents: normalizedCart?.total_cents,
        currency: normalizedCart?.currency || args.currency || "EUR",
        guardSubjectId,
        guardSubjectType,
        guardSubjectExternalId,
      }))

      const idempotencyKey = `wa-delegated:${args.orderId}:v1`
      const delegated = await this.requestDelegatedPayment({
        protocolSubjectHeader,
        principalSubjectType: principal.type,
        principalSubjectId: principal.id,
        guardSubjectId,
        guardSubjectType,
        guardSubjectExternalId,
        walletAddress: linkedWalletAddress,
        merchantOrderId: marketplaceOrder.orderId,
        amountCents: undefined,
        currency: args.currency || "EUR",
        actorType: args.actorType || "agent",
        channel: args.channel || "whatsapp",
        idempotencyKey,
      })
      const delegatedRecord = readRecord(delegated)
      const delegatedSession = readRecord(delegatedRecord?.session)
      const delegatedState =
        readString(delegatedSession?.state) ||
        readString(delegatedRecord?.state) ||
        ""
      this.log("payment_trace", buildPaymentTrace({
        stage: "delegated_payment_response",
        localOrderId: args.orderId,
        valuyaOrderId: marketplaceOrderId,
        protocolSubjectHeader,
        resource: this.resource,
        plan: this.plan,
        amountCents: normalizedCart?.total_cents,
        currency: normalizedCart?.currency || args.currency || "EUR",
        guardSubjectId,
        guardSubjectType,
        guardSubjectExternalId,
        delegatedState,
      }))
      const requiresStepup =
        delegatedSession?.requires_stepup === true ||
        delegatedRecord?.requires_stepup === true
      if (delegatedState.toLowerCase() === "requires_stepup") {
        const stepup = await this.createMarketplaceCheckoutLink({
          orderId: marketplaceOrder.orderId,
          protocolSubjectHeader,
        })
        this.log("payment_decision", {
          order_id: args.orderId,
          action: "checkout_required",
          reason: "requires_stepup",
          checkout_url: stepup.checkoutUrl,
          valuya_order_id: marketplaceOrderId,
        })
        return {
          ok: false,
          whoami: who,
          reason: "payment_stepup_required",
          checkoutUrl: stepup.checkoutUrl,
          valuyaOrderId: marketplaceOrderId,
        }
      }
      if (requiresStepup) {
        const stepup = await this.createMarketplaceCheckoutLink({
          orderId: marketplaceOrder.orderId,
          protocolSubjectHeader,
        })
        this.log("payment_decision", {
          order_id: args.orderId,
          action: "checkout_required",
          reason: "requires_stepup_flag",
          checkout_url: stepup.checkoutUrl,
          valuya_order_id: marketplaceOrderId,
        })
        return {
          ok: false,
          whoami: who,
          reason: "payment_stepup_required",
          checkoutUrl: stepup.checkoutUrl,
          valuyaOrderId: marketplaceOrderId,
        }
      }
      if (delegatedState.toLowerCase() === "entitled") {
        this.log("payment_decision", {
          order_id: args.orderId,
          action: "autopay_success",
          reason: "session_entitled",
        })
        return { ok: true, whoami: who, valuyaOrderId: marketplaceOrderId }
      }

      const after = await this.pollEntitlement({
        orderId: args.orderId,
        delegatedState,
        protocolSubjectHeader,
      })
      if (after.active) {
        this.log("payment_decision", {
          order_id: args.orderId,
          action: "autopay_success",
          reason: "entitlement_active",
        })
        return { ok: true, whoami: who, valuyaOrderId: marketplaceOrderId }
      }
      if (String(after.reason || "").toLowerCase() === "product_not_registered") {
        this.log("payment_decision", {
          order_id: args.orderId,
          action: "retryable_failure",
          reason: "product_not_registered",
          session_state: delegatedState,
          subject_header: protocolSubjectHeader,
          resource: this.resource,
          plan: this.plan,
        })
        return {
          ok: false,
          whoami: who,
          reason: "product_not_registered",
          valuyaOrderId: marketplaceOrderId,
        }
      }
      if (delegatedState.toLowerCase() === "pending_settlement") {
        this.log("payment_decision", {
          order_id: args.orderId,
          action: "pending_settlement_timeout",
          reason: "entitlement_not_active_after_delegated_payment",
          session_state: delegatedState,
        })
        return {
          ok: false,
          whoami: who,
          reason: "pending_settlement",
        }
      }
      this.log("payment_decision", {
        order_id: args.orderId,
        action: "retryable_failure",
        reason: "entitlement_not_active_after_delegated_payment",
        session_state: delegatedState,
      })
      return {
        ok: false,
        whoami: who,
        reason: "entitlement_not_active_after_delegated_payment",
      }
    } catch (error) {
      if (error instanceof DelegatedPaymentError) {
        const action = classifyDelegatedPaymentFailure(error)
        if (action === "checkout_required") {
          if (!marketplaceOrderId) {
            this.log("payment_decision", {
              order_id: args.orderId,
              action: "retryable_failure",
              reason: "marketplace_order_missing_before_checkout_fallback",
            })
            return {
              ok: false,
              whoami: who,
              reason: `agent_auto_payment_failed:${error.message}`,
            }
          }
          const fallback = await this.createMarketplaceCheckoutLink({
            orderId: marketplaceOrderId,
            protocolSubjectHeader,
          })
          this.log("payment_decision", {
            order_id: args.orderId,
            action,
            reason: error.code || error.message,
            checkout_url: fallback.checkoutUrl,
            valuya_order_id: marketplaceOrderId,
          })
          return {
            ok: false,
            whoami: who,
            reason: `agent_auto_payment_failed:${error.message}`,
            checkoutUrl: fallback.checkoutUrl,
            valuyaOrderId: marketplaceOrderId,
          }
        }

        if (action === "topup_required") {
          this.log("payment_decision", {
            order_id: args.orderId,
            action,
            reason: error.code || error.message,
            topup_url: error.topupUrl || null,
          })
          return {
            ok: false,
            whoami: who,
            reason: `agent_auto_payment_failed:${error.message}`,
            topupUrl: error.topupUrl,
          }
        }

        this.log("payment_decision", {
          order_id: args.orderId,
          action: "retryable_failure",
          reason: error.code || error.message,
        })
        return {
          ok: false,
          whoami: who,
          reason: `agent_auto_payment_failed:${error.message}`,
        }
      }

      const message = error instanceof Error ? error.message : String(error)
      this.log("payment_decision", {
        order_id: args.orderId,
        action: "retryable_failure",
        reason: message,
      })
      return {
        ok: false,
        whoami: who,
        reason: `agent_auto_payment_failed:${message}`,
      }
    }
  }

  async submitOrder(args: {
    subject: AgentSubject
    orderId: string
    cart?: CartState
    recipe?: RecipeState
    actorType?: string
    channel?: string
  }): Promise<{
    orderPayload: OrderPayload
    responseBody: unknown
  }> {
    const canonicalSubjectId = normalizeCanonicalSubjectId(`${args.subject.type}:${args.subject.id}`)
    const subject = parseSubjectId(canonicalSubjectId)
    const endpoint = `${this.backendBaseUrl}/api/agent/orders`
    const payload = buildOrderPayload({
      orderId: args.orderId,
      resource: this.resource,
      plan: this.plan,
      cart: args.cart,
      recipe: args.recipe,
      subject,
      actorType: args.actorType || "agent",
      channel: args.channel || "whatsapp",
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

  private async pollEntitlement(args: {
    orderId: string
    delegatedState: string
    protocolSubjectHeader: string
  }): Promise<EntitlementDecision> {
    let last: EntitlementDecision = { active: false, reason: "inactive" }
    let elapsedMs = 0
    for (let i = 0; i < this.entitlementPollDelaysMs.length; i++) {
      const delay = this.entitlementPollDelaysMs[i] ?? 0
      if (delay > 0) {
        this.log("payment_decision", {
          order_id: args.orderId,
          action: "pending_settlement_polling",
          reason: args.delegatedState || "unknown",
          session_state: args.delegatedState || null,
          poll_attempt: i + 1,
          sleep_ms: delay,
          elapsed_seconds: Math.trunc(elapsedMs / 1000),
          subject_header: args.protocolSubjectHeader,
        })
        await this.sleepFn(delay)
        elapsedMs += delay
      }
      last = await this.getEntitlement(args.protocolSubjectHeader)
      this.log("entitlement_recheck", {
        order_id: args.orderId,
        poll_attempt: i + 1,
        elapsed_seconds: Math.trunc(elapsedMs / 1000),
        session_state: args.delegatedState || null,
        subject_header: args.protocolSubjectHeader,
        resource: this.resource,
        plan: this.plan,
        tenant: tokenPreview(this.cfg.tenant_token),
        response_body: last,
      })
      if (last.active) return last
      if (String(args.delegatedState || "").toLowerCase() !== "pending_settlement" && i === 0) {
        return last
      }
    }
    return last
  }

  private async createMarketplaceOrderForDelegatedPayment(args: {
    orderId: string
    protocolSubjectHeader: string
    guardSubjectId?: string
    guardSubjectType?: string
    guardSubjectExternalId?: string
    amountCents?: number
    currency: string
    asset: string
    cart?: unknown
  }): Promise<{ orderId: string }> {
    const protocolSubjectHeader = String(args.protocolSubjectHeader || "").trim()
    if (!protocolSubjectHeader) throw new Error("marketplace_protocol_subject_missing_fail_safe")
    if (!Number.isFinite(this.marketplaceProductId) || this.marketplaceProductId <= 0) {
      throw new Error("marketplace_product_id_missing_fail_safe")
    }
    const guardSubjectId = String(args.guardSubjectId || "").trim()
    const guardSubjectType = String(args.guardSubjectType || "").trim()
    const guardSubjectExternalId = String(args.guardSubjectExternalId || "").trim()
    if (!guardSubjectId && (!guardSubjectType || !guardSubjectExternalId)) {
      throw new Error("marketplace_guard_subject_missing_fail_safe")
    }
    const normalizedCart = normalizeCartState(args.cart, args.amountCents, args.currency)
    const amountCents =
      normalizedCart?.total_cents ??
      (typeof args.amountCents === "number" && Number.isFinite(args.amountCents) && args.amountCents > 0
        ? Math.trunc(args.amountCents)
        : undefined)
    if (typeof amountCents !== "number" || amountCents <= 0) {
      throw new Error("marketplace_amount_missing_fail_safe")
    }

    const endpoint = `${this.cfg.base.replace(/\/+$/, "")}/api/marketplace/orders`
    const payload = {
      order_id: args.orderId,
      guard_subject: guardSubjectId
        ? { id: guardSubjectId }
        : { type: guardSubjectType, external_id: guardSubjectExternalId },
      protocol_subject_header: protocolSubjectHeader,
      product_id: this.marketplaceProductId,
      merchant_slug: this.marketplaceMerchantSlug,
      channel: "whatsapp",
      resource: this.resource,
      plan: this.plan,
      amount_cents: amountCents,
      currency: args.currency || "EUR",
      asset: args.asset || "EURe",
      cart: normalizeMarketplaceCart(normalizedCart),
      issue_checkout_token: false,
    }
    this.log("marketplace_order_create_request", {
      tenant: tokenPreview(this.cfg.tenant_token),
      subjectHeader: protocolSubjectHeader,
      order_id: args.orderId,
      product_id: this.marketplaceProductId,
      merchant_slug: this.marketplaceMerchantSlug,
      channel: "whatsapp",
      resource: this.resource,
      plan: this.plan,
      amount_cents: amountCents,
      guard_subject_id: guardSubjectId || null,
      guard_subject_type: guardSubjectType || null,
      guard_subject_external_id: guardSubjectExternalId || null,
    })

    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Authorization: `Bearer ${this.cfg.tenant_token}`,
        "X-Valuya-Subject-Id": protocolSubjectHeader,
        "Idempotency-Key": `marketplace-order:${payload.order_id}:v1`,
      },
      body: JSON.stringify(payload),
    })

    const body = await safeParseJson(response)
    this.log("marketplace_order_create_response", {
      tenant: tokenPreview(this.cfg.tenant_token),
      subjectHeader: protocolSubjectHeader,
      order_id: args.orderId,
      status: response.status,
      ok: response.ok,
      error_code: readString(readRecord(body)?.error) || readString(readRecord(body)?.code) || null,
      response_body: body,
      server_order_id: extractOrderId(body) || null,
    })
    if (!response.ok || readBoolean(readRecord(body)?.ok, true) === false) {
      throw new Error(`marketplace_order_create_failed:${response.status}:${JSON.stringify(body).slice(0, 300)}`)
    }
    const orderId = extractOrderId(body)
    if (!orderId) throw new Error("marketplace_order_id_missing_fail_safe")
    return { orderId }
  }

  private async createMarketplaceCheckoutLink(args: {
    orderId: string
    protocolSubjectHeader: string
  }): Promise<{ checkoutUrl: string }> {
    const protocolSubjectHeader = String(args.protocolSubjectHeader || "").trim()
    if (!protocolSubjectHeader) throw new Error("marketplace_protocol_subject_missing_fail_safe")
    const orderId = String(args.orderId || "").trim()
    if (!orderId) throw new Error("marketplace_order_id_missing_fail_safe")

    const endpoint = `${this.cfg.base.replace(/\/+$/, "")}/api/marketplace/orders/${encodeURIComponent(orderId)}/checkout-link`
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.cfg.tenant_token}`,
        "Content-Type": "application/json",
        Accept: "application/json",
        "X-Valuya-Subject-Id": protocolSubjectHeader,
      },
      body: JSON.stringify({}),
    })
    const body = readRecord(await safeParseJson(response))
    const checkoutUrl = readString(body?.checkout_url) || ""
    this.log("marketplace_checkout_link_response", {
      tenant: tokenPreview(this.cfg.tenant_token),
      subjectHeader: protocolSubjectHeader,
      order_id: orderId,
      status: response.status,
      ok: response.ok && readBoolean(body?.ok, true),
      checkout_url: checkoutUrl || null,
      response_body: body,
    })
    if (!response.ok || readBoolean(body?.ok, true) === false) {
      throw new Error(`marketplace_checkout_link_failed:${response.status}:${JSON.stringify(body).slice(0, 300)}`)
    }
    if (!checkoutUrl) throw new Error("marketplace_checkout_url_missing_fail_safe")
    return { checkoutUrl }
  }

  private async requestDelegatedPayment(args: {
    protocolSubjectHeader: string
    principalSubjectType: string
    principalSubjectId: string
    guardSubjectId?: string
    guardSubjectType?: string
    guardSubjectExternalId?: string
    walletAddress: string
    merchantOrderId?: string
    amountCents?: number
    currency: string
    actorType: string
    channel: string
    idempotencyKey: string
  }): Promise<unknown> {
    const endpoint = `${this.cfg.base.replace(/\/+$/, "")}/api/guard/payments/request`
    const hasGuardSubjectId = Boolean(args.guardSubjectId)
    const hasGuardSubjectTuple = Boolean(args.guardSubjectType && args.guardSubjectExternalId)
    if (!hasGuardSubjectId && !hasGuardSubjectTuple) {
      throw new Error("delegated_payment_guard_subject_missing_fail_safe")
    }
    const merchantOrderId = String(args.merchantOrderId || "").trim()
    const amountCents =
      typeof args.amountCents === "number" && Number.isFinite(args.amountCents) && args.amountCents > 0
        ? Math.trunc(args.amountCents)
        : undefined
    if (!merchantOrderId && typeof amountCents !== "number") {
      throw new Error("delegated_payment_input_missing_fail_safe")
    }

    const hasMerchantOrderId = Boolean(merchantOrderId)
    const delegatedMode = hasMerchantOrderId ? "merchant_order" : "amount_fallback"

    this.log("delegated_payment_request", {
      tenant: tokenPreview(this.cfg.tenant_token),
      subjectHeader: args.protocolSubjectHeader,
      principal_subject_type: args.principalSubjectType,
      principal_subject_id: args.principalSubjectId,
      wallet_address: args.walletAddress,
      wallet_source: "linked_privy_wallet",
      linked_privy_wallet_address: args.walletAddress,
      guard_agent_wallet_address: null,
      resource: this.resource,
      plan: this.plan,
      scope: "commerce.order",
      counterparty_type: "merchant",
      counterparty_id: "alfies",
      merchant_order_id: merchantOrderId || null,
      amount_cents: typeof amountCents === "number" ? amountCents : null,
      idempotency_key: args.idempotencyKey,
      delegated_mode: delegatedMode,
      delegated_payment_subject_kind: "guard_subject",
      guard_subject_id: hasGuardSubjectId ? String(args.guardSubjectId) : null,
      guard_subject_type: hasGuardSubjectTuple ? String(args.guardSubjectType) : null,
      guard_subject_external_id: hasGuardSubjectTuple ? String(args.guardSubjectExternalId) : null,
      protocol_subject_header: args.protocolSubjectHeader,
    })

    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.cfg.tenant_token}`,
        "Content-Type": "application/json",
        Accept: "application/json",
        "X-Valuya-Subject-Id": args.protocolSubjectHeader,
        "Idempotency-Key": args.idempotencyKey,
      },
      body: JSON.stringify({
        subject: hasGuardSubjectId
          ? { id: String(args.guardSubjectId) }
          : { type: String(args.guardSubjectType), external_id: String(args.guardSubjectExternalId) },
        principal_subject_type: args.principalSubjectType,
        principal_subject_id: args.principalSubjectId,
        wallet_address: args.walletAddress,
        actor_type: args.actorType,
        channel: args.channel,
        scope: "commerce.order",
        counterparty_type: "merchant",
        counterparty_id: "alfies",
        ...(merchantOrderId ? { merchant_order_id: merchantOrderId } : {}),
        ...(typeof amountCents === "number" ? { amount_cents: amountCents } : {}),
        currency: args.currency || "EUR",
        asset: "EURe",
        idempotency_key: args.idempotencyKey,
        resource: this.resource,
        plan: this.plan,
      }),
    })

    const body = await safeParseJson(response)
    this.log("delegated_payment_response", {
      tenant: tokenPreview(this.cfg.tenant_token),
      subjectHeader: args.protocolSubjectHeader,
      merchant_order_id: merchantOrderId || null,
      amount_cents: typeof amountCents === "number" ? amountCents : null,
      status: response.status,
      ok: response.ok && readBoolean(readRecord(body)?.ok, true),
      error_code: readString(readRecord(body)?.code) || readString(readRecord(body)?.error) || null,
      response_body: body,
    })
    if (!response.ok || (body as any)?.ok === false) {
      throw new DelegatedPaymentError(response.status, body)
    }
    return body
  }

  private async getEntitlement(protocolSubjectHeader: string): Promise<EntitlementDecision> {
    const subjectId = normalizeCanonicalSubjectId(protocolSubjectHeader)
    const subject = parseSubjectId(subjectId)
    this.log("payment_trace", buildPaymentTrace({
      stage: "entitlement_request",
      protocolSubjectHeader: subjectId,
      resource: this.resource,
      plan: this.plan,
    }))
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

  private async createMarketplaceOrderIntent(args: {
    localOrderId: string
    protocolSubjectHeader: string
    guardSubjectId?: string
    guardSubjectType?: string
    guardSubjectExternalId?: string
    amountCents?: number
    currency: string
    asset: string
    cart?: unknown
  }): Promise<{ checkoutUrl: string; valuyaOrderId: string }> {
    const protocolSubjectHeader = String(args.protocolSubjectHeader || "").trim()
    if (!protocolSubjectHeader) throw new Error("marketplace_protocol_subject_missing_fail_safe")
    if (!this.resource.trim()) throw new Error("marketplace_resource_missing_fail_safe")
    if (!this.plan.trim()) throw new Error("marketplace_plan_missing_fail_safe")
    if (!Number.isFinite(this.marketplaceProductId) || this.marketplaceProductId <= 0) {
      throw new Error("marketplace_product_id_missing_fail_safe")
    }
    const guardSubjectId = String(args.guardSubjectId || "").trim()
    const guardSubjectType = String(args.guardSubjectType || "").trim()
    const guardSubjectExternalId = String(args.guardSubjectExternalId || "").trim()
    if (!guardSubjectId && (!guardSubjectType || !guardSubjectExternalId)) {
      throw new Error("marketplace_guard_subject_missing_fail_safe")
    }
    const amountCents =
      typeof args.amountCents === "number" && Number.isFinite(args.amountCents) && args.amountCents > 0
        ? Math.trunc(args.amountCents)
        : undefined
    if (!amountCents) throw new Error("marketplace_amount_missing_fail_safe")
    const cart = normalizeMarketplaceCart(args.cart)

    const endpoint = `${this.cfg.base.replace(/\/+$/, "")}/api/marketplace/orders`
    this.log("marketplace_order_intent_request", {
      tenant: tokenPreview(this.cfg.tenant_token),
      local_order_id: args.localOrderId,
      product_id: this.marketplaceProductId,
      resource: this.resource,
      plan: this.plan,
      guard_subject_id: guardSubjectId || null,
      guard_subject_type: guardSubjectType || null,
      guard_subject_external_id: guardSubjectExternalId || null,
      protocol_subject_header: protocolSubjectHeader,
      merchant_slug: this.marketplaceMerchantSlug,
      channel: "whatsapp",
      amount_cents: amountCents,
    })

    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.cfg.tenant_token}`,
        "Content-Type": "application/json",
        Accept: "application/json",
        "X-Valuya-Subject-Id": protocolSubjectHeader,
        "Idempotency-Key": `marketplace-order:${args.localOrderId}:v1`,
      },
      body: JSON.stringify({
        guard_subject: guardSubjectId
          ? { id: guardSubjectId }
          : { type: guardSubjectType, external_id: guardSubjectExternalId },
        protocol_subject_header: protocolSubjectHeader,
        product_id: this.marketplaceProductId,
        merchant_slug: this.marketplaceMerchantSlug,
        channel: "whatsapp",
        resource: this.resource,
        plan: this.plan,
        amount_cents: amountCents,
        currency: args.currency || "EUR",
        asset: args.asset || "EURe",
        cart,
      }),
    })
    const body = readRecord(await safeParseJson(response))
    const order = readRecord(body?.order)
    const checkoutUrl = readString(body?.checkout_url) || ""
    const valuyaOrderId =
      readString(order?.order_id) ||
      readString(order?.id) ||
      ""
    this.log("marketplace_order_intent_response", {
      tenant: tokenPreview(this.cfg.tenant_token),
      local_order_id: args.localOrderId,
      status: response.status,
      ok: response.ok && readBoolean(body?.ok, true),
      returned_valuya_order_id: valuyaOrderId || null,
      checkout_url: checkoutUrl || null,
    })
    if (!response.ok || readBoolean(body?.ok, true) === false) {
      throw new Error(`marketplace_order_intent_failed:${response.status}:${JSON.stringify(body).slice(0, 300)}`)
    }
    if (!checkoutUrl) throw new Error("marketplace_checkout_url_missing_fail_safe")
    if (!valuyaOrderId) throw new Error("marketplace_order_id_missing_fail_safe")
    return { checkoutUrl, valuyaOrderId }
  }

}

function buildPaymentTrace(args: {
  stage: string
  localOrderId?: string
  valuyaOrderId?: string
  protocolSubjectHeader: string
  resource: string
  plan: string
  amountCents?: number
  currency?: string
  guardSubjectId?: string
  guardSubjectType?: string
  guardSubjectExternalId?: string
  delegatedState?: string
  entitlementActive?: boolean
  entitlementReason?: string
}): Record<string, unknown> {
  return {
    trace_kind: "payment_correlation",
    stage: args.stage,
    local_order_id: args.localOrderId || null,
    valuya_order_id: args.valuyaOrderId || null,
    protocol_subject_header: args.protocolSubjectHeader || null,
    resource: args.resource,
    plan: args.plan,
    amount_cents: typeof args.amountCents === "number" ? args.amountCents : null,
    currency: args.currency || null,
    guard_subject_id: args.guardSubjectId || null,
    guard_subject_type: args.guardSubjectType || null,
    guard_subject_external_id: args.guardSubjectExternalId || null,
    delegated_state: args.delegatedState || null,
    entitlement_active:
      typeof args.entitlementActive === "boolean" ? args.entitlementActive : null,
    entitlement_reason: args.entitlementReason || null,
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

type PaymentDecisionAction = "autopay_success" | "topup_required" | "checkout_required" | "retryable_failure"

class DelegatedPaymentError extends Error {
  readonly status: number
  readonly body: unknown
  readonly code: string
  readonly state: string
  readonly topupUrl?: string

  constructor(status: number, body: unknown) {
    const record = readRecord(body)
    const code = String(record?.code || record?.error || "").trim().toLowerCase()
    const state = String(record?.state || "").trim().toLowerCase()
    super(`delegated_payment_request_failed:${status}:${JSON.stringify(body).slice(0, 300)}`)
    this.status = status
    this.body = body
    this.code = code
    this.state = state
    this.topupUrl = extractTopupUrl(body)
  }
}

function classifyDelegatedPaymentFailure(error: DelegatedPaymentError): PaymentDecisionAction {
  const marker = `${error.code} ${error.state} ${JSON.stringify(error.body).toLowerCase()}`
  if (marker.includes("product_not_registered")) {
    return "retryable_failure"
  }
  if (marker.includes("requires_stepup") || marker.includes("payment_required")) {
    return "checkout_required"
  }
  if (
    marker.includes("payment_estimation_failed") ||
    marker.includes("estimation_failed") ||
    marker.includes("insufficient_balance")
  ) {
    return "topup_required"
  }
  return "retryable_failure"
}

function resolveDelegatedPrincipal(who: WhoamiResponse, fallbackSubjectHeader: string): AgentSubject {
  const principalType = String(who.principal?.subject?.type || "").trim()
  const principalId = String(who.principal?.subject?.id || "").trim()
  if (principalType && principalId) {
    return { type: principalType, id: principalId }
  }
  return parseSubjectId(fallbackSubjectHeader)
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
  subject: AgentSubject
  actorType: string
  channel: string
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
      actor_type: args.actorType,
      channel: args.channel,
      subject_type: args.subject.type,
      subject_external_id: args.subject.id,
    },
  }
}

function normalizeCartState(
  cart: unknown,
  amountCents?: number,
  currency?: string,
): CartState | undefined {
  if (Array.isArray(cart)) {
    return {
      items: cart,
      ...(typeof amountCents === "number" && Number.isFinite(amountCents)
        ? { total_cents: Math.trunc(amountCents) }
        : {}),
      currency: String(currency || "EUR").trim() || "EUR",
    }
  }

  if (cart && typeof cart === "object") {
    const record = cart as Record<string, unknown>
    const items = Array.isArray(record.items) ? record.items : undefined
    const total =
      typeof record.total_cents === "number" && Number.isFinite(record.total_cents)
        ? Math.trunc(record.total_cents)
        : typeof amountCents === "number" && Number.isFinite(amountCents)
          ? Math.trunc(amountCents)
          : undefined
    const currentCurrency = String(record.currency || currency || "EUR").trim() || "EUR"
    return {
      ...(items ? { items } : {}),
      ...(typeof total === "number" ? { total_cents: total } : {}),
      currency: currentCurrency,
    }
  }

  return undefined
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

function normalizeWallet(input: unknown): string | undefined {
  const value = String(input || "").trim().toLowerCase()
  if (!value) return undefined
  if (!/^0x[a-f0-9]{40}$/.test(value)) return undefined
  return value
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

function extractOrderId(body: unknown): string | undefined {
  const b = body && typeof body === "object" ? (body as Record<string, unknown>) : {}
  const candidates = [b.order_id, (b.order as any)?.order_id, (b.order as any)?.id, b.id]
  for (const c of candidates) {
    if (typeof c === "string" && c.trim()) return c.trim()
    if (typeof c === "number" && Number.isFinite(c)) return String(c)
  }
  return undefined
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
  const v = String(token || "").trim()
  return v ? v.slice(0, 12) : "unknown"
}

function normalizeMarketplaceCart(input: unknown): { items: unknown[] } {
  if (input && typeof input === "object") {
    const obj = input as Record<string, unknown>
    if (Array.isArray(obj.items)) {
      return { items: obj.items }
    }
  }
  if (Array.isArray(input)) return { items: input }
  return { items: [] }
}
