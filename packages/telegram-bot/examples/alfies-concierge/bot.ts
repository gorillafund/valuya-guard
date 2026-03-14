import { randomUUID } from "node:crypto"
import { existsSync, readFileSync } from "node:fs"
import { resolve } from "node:path"
import type { AgentConfig, AgentSubject } from "@valuya/agent"
import {
  apiJson,
  isValuyaApiError,
} from "@valuya/agent"
import {
  buildMarketplaceSessionSnapshot,
  buildPaymentConfirmedReply as buildPaymentConfirmedReplyCore,
  buildTransactionLines as buildTransactionLinesCore,
  decideMarketplaceStatus,
  readMarketplaceTransaction as readMarketplaceTransactionCore,
} from "@valuya/marketplace-agent-core"
import {
  buildOrderPayload,
  sendOrderToBackendRequest,
  type OrderPayload,
} from "./orderBackend.js"
import { GuardTelegramLinkService, extractStartLinkToken } from "./channelLinking.js"
import { TelegramLinkStore } from "./linkStore.js"
import {
  fetchManagedAgentCapacity,
  formatCapacityAmount,
  summarizeManagedAgentCapacity,
} from "./managedAgentCapacity.js"
import { MarketplaceOrderStore } from "./marketplaceOrderStore.js"
import {
  createMarketplaceCheckoutLink,
  createMarketplaceOrder,
  createMarketplaceOrderIntent,
  getMarketplaceOrder,
} from "./marketplaceOrders.js"
import {
  extractLinkedPrivyWalletAddress,
  normalizeWallet as normalizeWalletAddress,
} from "./walletSelection.js"
import { DelegatedPaymentError, requestDelegatedPayment } from "./delegatedPayment.js"
import { TelegramSmartConcierge } from "@valuya/telegram-bot"

type ConciergeAction = "recipe" | "alt" | "confirm" | "cancel"

type TelegramButton = {
  text: string
  url?: string
  callback_data?: string
}

type TelegramMarkup = {
  inline_keyboard: TelegramButton[][]
}

type ConciergeResponse = {
  ok?: boolean
  orderId?: string
  telegram?: {
    text?: string
    keyboard?: unknown
  }
  messages?: string[]
  recipe?: { title?: string }
  cart?: { items?: unknown; total_cents?: unknown }
  [k: string]: unknown
}

type OrderContext = {
  recipeTitle?: string
  totalCents?: number
  cartItems?: unknown[]
}

type EntitlementDecision = {
  active: boolean
  reason?: string
  evaluated_plan?: string
  required?: { type: string; plan?: string; [k: string]: unknown }
}

type PaymentAttemptResult = {
  entitlement: EntitlementDecision
  txHash?: string
  chainId?: number
  reason?: "pending_settlement" | "payment_stepup_required" | "topup_required" | "retryable_failure"
  checkoutUrl?: string
  topupUrl?: string
  valuyaOrderId?: string
}

type WhoamiResponse = {
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

type TelegramMessage = {
  text?: string
  chat: { id: number }
  from?: { id: number; username?: string }
}

type TelegramCallbackQuery = {
  id: string
  data?: string
  from: { id: number; username?: string }
  message?: { chat: { id: number } }
}

type TelegramUpdate = {
  update_id: number
  message?: TelegramMessage
  callback_query?: TelegramCallbackQuery
}

type TelegramApiResponse<T> = { ok: boolean; result: T; description?: string }

type ParsedCallback =
  | { kind: "consent" }
  | { kind: "action"; action: "confirm" | "alt" | "cancel"; orderId: string }

type LinkedPurchaseContext = {
  subject: AgentSubject
  linkedPrivyWalletAddress?: string
  protocolSubjectHeader?: string
  protocolSubjectType?: string
  protocolSubjectId?: string
  guardSubjectId?: string
  guardSubjectType?: string
  guardSubjectExternalId?: string
}

loadEnvFromDotFile()

const TELEGRAM_BOT_TOKEN = requiredEnv("TELEGRAM_BOT_TOKEN")
const N8N_BASE_URL = requiredEnv("N8N_BASE_URL").replace(/\/$/, "")
const N8N_WEBHOOK_PATH =
  process.env.N8N_WEBHOOK_PATH?.trim() || "/webhook/alfies/concierge"
const VALUYA_BASE = requiredEnv("VALUYA_BASE").replace(/\/$/, "")
const VALUYA_TENANT_TOKEN = requiredEnv("VALUYA_TENANT_TOKEN")
const VALUYA_BACKEND_BASE_URL = requiredEnv("VALUYA_BACKEND_BASE_URL").replace(
  /\/$/,
  "",
)
const VALUYA_BACKEND_TOKEN =
  process.env.VALUYA_BACKEND_TOKEN?.trim() || VALUYA_TENANT_TOKEN
const TELEGRAM_CHANNEL_APP_ID = process.env.TELEGRAM_CHANNEL_APP_ID?.trim() || "telegram_main"
const TELEGRAM_LINKS_FILE =
  process.env.TELEGRAM_LINKS_FILE?.trim() ||
  resolve(process.cwd(), ".data/telegram-links.json")
const MARKETPLACE_ORDERS_FILE =
  process.env.MARKETPLACE_ORDERS_FILE?.trim() ||
  resolve(process.cwd(), ".data/marketplace-orders.json")

const TELEGRAM_API = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}`
const N8N_WEBHOOK_URL = `${N8N_BASE_URL}${N8N_WEBHOOK_PATH.startsWith("/") ? "" : "/"}${N8N_WEBHOOK_PATH}`

const RESOURCE =
  process.env.VALUYA_RESOURCE?.trim() ||
  "telegram:bot:8748562521_aagildb2h9wfenj7uh5snityv-7zukwdj5o:recipe_confirm_alt_cancel_status"
const PLAN = process.env.VALUYA_PLAN?.trim() || "standard"
const CAPACITY_RESOURCE = process.env.TELEGRAM_CAPACITY_RESOURCE?.trim() || RESOURCE
const CAPACITY_PLAN = process.env.TELEGRAM_CAPACITY_PLAN?.trim() || PLAN
const MAX_RETRIES = 3
const INITIAL_BACKOFF_MS = 300
const POLL_TIMEOUT_SECONDS = 25
const DELEGATED_COUNTERPARTY_TYPE = "merchant"
const DELEGATED_COUNTERPARTY_ID = process.env.VALUYA_COUNTERPARTY_ID?.trim() || "alfies"
const DELEGATED_SCOPE = process.env.VALUYA_DELEGATED_SCOPE?.trim() || "commerce.order"
const DELEGATED_CURRENCY = process.env.VALUYA_PAYMENT_CURRENCY?.trim() || "EUR"
const DELEGATED_ASSET = process.env.VALUYA_PAYMENT_ASSET?.trim() || "EURe"
const MARKETPLACE_MERCHANT_SLUG = process.env.MARKETPLACE_MERCHANT_SLUG?.trim() || DELEGATED_COUNTERPARTY_ID
const MARKETPLACE_PRODUCT_ID = requiredPositiveInt(
  process.env.MARKETPLACE_PRODUCT_ID || process.env.VALUYA_PRODUCT_ID,
  "MARKETPLACE_PRODUCT_ID_or_VALUYA_PRODUCT_ID_required",
)

const cfg: AgentConfig = {
  base: VALUYA_BASE,
  tenant_token: VALUYA_TENANT_TOKEN,
}

const consentByUser = new Map<string, boolean>()
const orderContextByOrderId = new Map<string, OrderContext>()
const linkStore = new TelegramLinkStore(TELEGRAM_LINKS_FILE)
const marketplaceOrderStore = new MarketplaceOrderStore(MARKETPLACE_ORDERS_FILE)
const guardLinking = new GuardTelegramLinkService({
  baseUrl: VALUYA_BASE,
  tenantToken: VALUYA_TENANT_TOKEN,
  channelAppId: TELEGRAM_CHANNEL_APP_ID,
  linkStore,
  logger: log,
})
const smartConcierge = new TelegramSmartConcierge()

if (PLAN.toLowerCase() === "free") {
  throw new Error("VALUYA_PLAN_free_not_allowed")
}

void run()

async function run(): Promise<void> {
  log("bot_started", {
    webhook: N8N_WEBHOOK_URL,
    valuyaBase: VALUYA_BASE,
    backendBaseUrl: VALUYA_BACKEND_BASE_URL,
    channelAppId: TELEGRAM_CHANNEL_APP_ID,
    linksFile: TELEGRAM_LINKS_FILE,
    marketplaceOrdersFile: MARKETPLACE_ORDERS_FILE,
    marketplaceProductId: MARKETPLACE_PRODUCT_ID,
    resource: RESOURCE,
    plan: PLAN,
    devNote:
      "order_id is random per order request (DEV mode). Re-check id strategy before production.",
  })
  let offset = 0

  while (true) {
    try {
      const updates = await telegramCall<TelegramUpdate[]>("getUpdates", {
        timeout: POLL_TIMEOUT_SECONDS,
        offset,
        allowed_updates: ["message", "callback_query"],
      })

      for (const update of updates) {
        offset = update.update_id + 1
        await handleUpdate(update)
      }
    } catch (error) {
      logError("poll_error", error, {})
      await sleep(1000)
    }
  }
}

async function handleUpdate(update: TelegramUpdate): Promise<void> {
  if (update.message) {
    await handleMessage(update.message)
    return
  }
  if (update.callback_query) {
    await handleCallback(update.callback_query)
  }
}

async function handleMessage(message: TelegramMessage): Promise<void> {
  const text = message.text?.trim()
  const from = message.from
  if (!text || !from) return

  const chatId = message.chat.id
  const userId = String(from.id)

  if (/^\/start(?:@\w+)?(?:\s+\S+)?$/i.test(text)) {
    await handleStart(chatId, from, text)
    return
  }

  if (text === "/status") {
    await handleStatus(chatId, from)
    return
  }

  if (text === "/whoami") {
    const payment = await ensureLinkedSubjectForPaymentAction({
      chatId,
      telegramUserId: from.id,
      telegramUsername: from.username,
    })
    if (!payment) return
    const who = await whoamiForSubject(payment.subject)
    const capacityText = await formatManagedCapacityText(payment.subject)
    await sendMarkdown(
      chatId,
      [
        formatWhoamiText(who, payment.subject),
        ...(capacityText ? ["", capacityText] : []),
      ].join("\n"),
    )
    return
  }

  if (text.startsWith("/")) return

  if (!consentByUser.get(userId)) {
    await sendConsentPrompt(chatId)
    return
  }

  const linked = await ensureLinkedSubjectForPaymentAction({
    chatId,
    telegramUserId: from.id,
    telegramUsername: from.username,
  })
  if (!linked) return

  // DEV NOTE: force a new random order_id for every order request.
  // TODO: double-check final order_id strategy before production.
  const orderId = randomUUID()

  await sendChatAction(chatId, "typing")

  const response =
    await smartConcierge.handleMessage({
      subjectId: smartSubjectId(from.id, linked.protocolSubjectHeader),
      message: text,
      existingOrderId: orderId,
    }) ||
    await callConciergeWithRetry({
      action: "recipe",
      orderId,
      message: text,
      subject: linked.subject,
      channelContext: { type: "telegram", id: from.id },
      actor_type: "agent",
      channel: "telegram",
    })

  updateOrderContextFromConcierge(response)
  await sendConciergeResponse(chatId, response)
}

async function handleCallback(query: TelegramCallbackQuery): Promise<void> {
  const parsed = parseCallback(query.data || "")
  if (!parsed) {
    await answerCallback(query.id, "Unsupported action")
    return
  }

  const chatId = query.message?.chat.id
  if (!chatId) {
    await answerCallback(query.id, "Missing chat context")
    return
  }

  const telegramUserId = query.from.id
  const userId = String(telegramUserId)

    if (parsed.kind === "consent") {
      consentByUser.set(userId, true)
      await answerCallback(query.id, "Consent saved")
      await sendMarkdown(
        chatId,
        escapeMarkdownV2("Consent gespeichert. Du kannst jetzt direkt einkaufen oder 'start' fuer die Concierge-Erklaerung senden."),
      )
      return
    }

  if (!consentByUser.get(userId)) {
    await answerCallback(query.id, "Please consent first")
    await sendConsentPrompt(chatId)
    return
  }

  const linked = await ensureLinkedSubjectForPaymentAction({
    chatId,
    telegramUserId,
    telegramUsername: query.from.username,
  })
  if (!linked) {
    await answerCallback(query.id, "Link your account first")
    return
  }
  const resolvedPaymentSubject = linked.subject
  const resolvedCanonicalSubject = String(linked.protocolSubjectHeader || "").trim()
  const localOrderIdCandidate = parsed.kind === "action" ? parsed.orderId : ""

  await sendChatAction(chatId, "typing")

  if (parsed.action === "confirm") {
    const orderPayload = buildOrderPayloadForBackend(localOrderIdCandidate)
    orderPayload.meta = {
      ...orderPayload.meta,
      actor_type: "agent",
      channel: "telegram",
      subject_type: linked.protocolSubjectType || resolvedPaymentSubject.type,
      subject_external_id: linked.protocolSubjectId || resolvedPaymentSubject.id,
    }

    const who = await whoamiForSubject(resolvedPaymentSubject)
    let paymentResult: PaymentAttemptResult
    try {
      paymentResult = await ensureEntitledViaAgent({
        subject: resolvedPaymentSubject,
        subjectHeader: resolvedCanonicalSubject,
        linkedPrivyWalletAddress: linked.linkedPrivyWalletAddress,
        orderId: localOrderIdCandidate,
        amountCents: toInt(orderPayload.meta.total_cents),
        cart: orderPayload.products,
        guardSubjectId: linked.guardSubjectId,
        guardSubjectType: linked.guardSubjectType,
        guardSubjectExternalId: linked.guardSubjectExternalId,
      })
    } catch (error) {
      logError("agent_purchase_error", error, {
        orderId: localOrderIdCandidate,
        localOrderIdCandidate,
        subjectId: resolvedCanonicalSubject,
      })
      await answerCallback(query.id, "Payment failed")
      await sendMarkdown(
        chatId,
        [
          escapeMarkdownV2("Automatic agent payment failed."),
          "",
          formatWhoamiText(who, resolvedPaymentSubject),
          "",
          escapeMarkdownV2("Please retry confirm in a few seconds."),
        ].join("\n"),
      )
      return
    }

    const entitlement = paymentResult.entitlement
    if (!entitlement.active) {
      if (paymentResult.checkoutUrl) {
        await answerCallback(query.id, "Checkout required")
        await sendMarkdown(
          chatId,
          escapeMarkdownV2(
            "Checkout required for this order amount. Please complete payment with the button, then confirm again.",
          ),
          {
            inline_keyboard: [
              [{ text: "Top up / Pay", url: paymentResult.checkoutUrl }],
              [{ text: "🔁 Erneut bestätigen", callback_data: `confirm:${localOrderIdCandidate}` }],
            ],
          },
        )
        return
      }
      await answerCallback(query.id, paymentResult.reason === "pending_settlement" ? "Payment pending" : "Payment not active")
      await sendMarkdown(
        chatId,
        [
          escapeMarkdownV2(
            paymentResult.reason === "pending_settlement"
              ? "Zahlung wurde gesendet und wird noch bestätigt. Bitte gleich noch einmal versuchen."
              : paymentResult.topupUrl
                ? "Dein Wallet-Guthaben reicht für die automatische Agent-Zahlung aktuell nicht aus."
                : "Automatic agent payment failed.",
          ),
          ...(paymentResult.topupUrl
            ? ["", `[Top up / Pay](${paymentResult.topupUrl})`]
            : []),
          "",
          formatWhoamiText(who, resolvedPaymentSubject),
        ].join("\n"),
        paymentResult.topupUrl
          ? {
              inline_keyboard: [
                [{ text: "Top up / Pay", url: paymentResult.topupUrl }],
                [{ text: "🔁 Erneut bestätigen", callback_data: `confirm:${localOrderIdCandidate}` }],
              ],
            }
          : undefined,
      )
      return
    }

    if (paymentResult.txHash) {
      const txUrl = txExplorerUrl(paymentResult.txHash, paymentResult.chainId)
      await sendMarkdown(
        chatId,
        [
          escapeMarkdownV2("Payment successful."),
          txUrl
            ? `[View transaction on PolygonScan](${txUrl})`
            : escapeMarkdownV2(`Tx hash: ${paymentResult.txHash}`),
        ].join("\n"),
      )
    }
    const backendSubjectId = resolvedCanonicalSubject
    log("confirm_flow_start", {
      localOrderIdCandidate,
      orderId: orderPayload.order_id,
      subjectId: backendSubjectId,
      resource: RESOURCE,
      plan: PLAN,
      flow_branch: "delegated_guard_autopay_path",
      valuya_order_id: paymentResult.valuyaOrderId || null,
    })

    try {
      const response =
        await smartConcierge.handleAction({
          subjectId: smartSubjectId(telegramUserId, linked.protocolSubjectHeader),
          orderId: parsed.orderId,
          action: "confirm",
        }) ||
        await callConciergeWithRetry({
          action: "confirm",
          orderId: parsed.orderId,
          subject: resolvedPaymentSubject,
          channelContext: { type: "telegram", id: telegramUserId },
          actor_type: "agent",
          channel: "telegram",
        })

      await answerCallback(query.id, "Updated")
      updateOrderContextFromConcierge(response)
      await sendConciergeResponse(chatId, response)

      log("order_request_sent", {
        orderId: orderPayload.order_id,
        subjectId: backendSubjectId,
        resource: RESOURCE,
        plan: PLAN,
      })
      const backendResponse = await sendOrderToBackend(orderPayload, backendSubjectId)
      const externalOrderId =
        readString(readRecord(backendResponse)?.external_order_id) ||
        readString(readRecord(backendResponse)?.order_id) ||
        orderPayload.order_id
      const externalOrderStatus =
        readString(readRecord(backendResponse)?.status) ||
        readString(readRecord(backendResponse)?.external_order_status)

      if (paymentResult.valuyaOrderId) {
        await marketplaceOrderStore.upsert(orderPayload.order_id, {
          valuya_order_id: paymentResult.valuyaOrderId,
          protocol_subject_header: backendSubjectId,
          amount_cents:
            toInt(orderPayload.meta?.total_cents) ||
            calculateOrderAmountCents(orderPayload.products) ||
            1,
          currency: DELEGATED_CURRENCY,
          status: "paid_confirmed",
          external_order_id: externalOrderId,
          ...(externalOrderStatus ? { external_order_status: externalOrderStatus } : {}),
          submitted_at: new Date().toISOString(),
        })
      }

      let marketplaceOrderStatus: unknown = null
      if (paymentResult.valuyaOrderId) {
        try {
          marketplaceOrderStatus = await getMarketplaceOrder({
            baseUrl: VALUYA_BASE,
            tenantToken: VALUYA_TENANT_TOKEN,
            orderId: paymentResult.valuyaOrderId,
            protocolSubjectHeader: backendSubjectId,
          })
        } catch (error) {
          logError("marketplace_order_status_after_submit_error", error, {
            localOrderId: orderPayload.order_id,
            valuyaOrderId: paymentResult.valuyaOrderId,
            protocolSubjectHeader: backendSubjectId,
          })
        }
      }

      await sendMarkdown(
        chatId,
        formatMarketplaceStatusText({
          marketplaceOrder: marketplaceOrderStatus,
          storedOrder: {
            external_order_id: externalOrderId,
          },
        }),
      )
    } catch (error) {
      await sendOrderFailedMessage(
        chatId,
        orderPayload.order_id,
        backendSubjectId,
        error,
      )
    }
    return
  }

  const response =
    await smartConcierge.handleAction({
      subjectId: smartSubjectId(telegramUserId, linked.protocolSubjectHeader),
      orderId: parsed.orderId,
      action: parsed.action,
    }) ||
    await callConciergeWithRetry({
      action: parsed.action,
      orderId: parsed.orderId,
      subject: resolvedPaymentSubject,
      channelContext: { type: "telegram", id: telegramUserId },
      actor_type: "agent",
      channel: "telegram",
    })

  await answerCallback(query.id, "Updated")
  updateOrderContextFromConcierge(response)
  await sendConciergeResponse(chatId, response)
}

async function sendOrderFailedMessage(
  chatId: number,
  orderId: string,
  subjectId: string,
  error: unknown,
): Promise<void> {
  logError("order_backend_error", error, {
    orderId,
    subjectId,
  })
  await sendMarkdown(
    chatId,
    escapeMarkdownV2(
      "Bestellung bezahlt, aber E-Mail Versand konnte nicht bestätigt werden.",
    ),
  )
}

async function sendPaymentRequiredMessage(
  chatId: number,
  linked: LinkedPurchaseContext,
  orderPayload: OrderPayload,
  orderId: string,
): Promise<void> {
  const subject = linked.subject
  const subjectHeader = String(linked.protocolSubjectHeader || "").trim()
  if (!String(subjectHeader || "").trim()) {
    log("linked_protocol_subject_missing", {
      tenant: tokenPreview(VALUYA_TENANT_TOKEN),
      subjectHeader: null,
      principal_subject_type: null,
      principal_subject_id: null,
      wallet_address: null,
      wallet_source: "protocol_subject_missing_fail_safe",
      linked_privy_wallet_address: null,
      guard_agent_wallet_address: null,
      resource: RESOURCE,
      plan: PLAN,
      orderId,
      error: "linked_protocol_subject_missing_fail_safe",
    })
    throw new Error("linked_protocol_subject_missing_fail_safe")
  }

  const ent = await getEntitlement(subject)
  if (ent.active) {
    await sendMarkdown(
      chatId,
      escapeMarkdownV2(
        "Mandat scheint aktiv. Bitte bestätige die Bestellung erneut.",
      ),
      {
        inline_keyboard: [[{ text: "🔁 Erneut bestätigen", callback_data: `confirm:${orderId}` }]],
      },
    )
    return
  }

  const marketplaceIntent = await createMarketplaceOrderIntentForCheckout({
    linked,
    orderPayload,
    localOrderId: orderId,
  })

  log("marketplace_checkout_link_sent", {
    tenant: tokenPreview(VALUYA_TENANT_TOKEN),
    local_order_id: orderId,
    returned_valuya_order_id: marketplaceIntent.valuyaOrderId,
    checkout_url: marketplaceIntent.checkoutUrl,
    guard_subject_id: linked.guardSubjectId || null,
    guard_subject_type: linked.guardSubjectType || null,
    guard_subject_external_id: linked.guardSubjectExternalId || null,
    protocol_subject_header: subjectHeader,
    product_id: MARKETPLACE_PRODUCT_ID,
    merchant_slug: MARKETPLACE_MERCHANT_SLUG,
    channel: "telegram",
    resource: RESOURCE,
    plan: PLAN,
    amount_cents:
      toInt(orderPayload.meta?.total_cents) ||
      calculateOrderAmountCents(orderPayload.products),
  })

  await sendMarkdown(
    chatId,
    escapeMarkdownV2(
      "Checkout required for this order amount. Please complete payment with the button, then confirm again.",
    ),
    {
      inline_keyboard: [
        [{ text: "Top up / Pay", url: marketplaceIntent.checkoutUrl }],
        [{ text: "🔁 Erneut bestätigen", callback_data: `confirm:${orderId}` }],
      ],
    },
  )
}

async function handleStatus(
  chatId: number,
  from: { id: number; username?: string },
): Promise<void> {
  const linked = await ensureLinkedSubjectForPaymentAction({
    chatId,
    telegramUserId: from.id,
    telegramUsername: from.username,
  })
  if (!linked) return
  const subject = linked.subject
  const entitlement = await getEntitlement(subject)
  const who = await whoamiForSubject(subject)
  const capacityText = await formatManagedCapacityText(subject)
  const latestMarketplaceOrder = await marketplaceOrderStore.getLatestByProtocolSubject(
    linked.protocolSubjectHeader || "",
  )
  const baseSnapshot = buildMarketplaceSessionSnapshot({
    entitlementActive: entitlement.active,
    reason: entitlement.reason,
    marketplaceOrderId: latestMarketplaceOrder?.valuya_order_id,
    checkoutUrl: latestMarketplaceOrder?.checkout_url,
    externalOrderId: latestMarketplaceOrder?.external_order_id,
    submittedToMerchant: Boolean(latestMarketplaceOrder?.external_order_id),
  })
  const statusDecision = decideMarketplaceStatus({
    snapshot: baseSnapshot,
    hasMarketplaceOrderStatus: false,
  })

  if (statusDecision.kind !== "inactive") {
    if (statusDecision.kind === "fetch_order_status" && latestMarketplaceOrder?.valuya_order_id) {
      try {
        const marketplaceOrder = await getMarketplaceOrder({
          baseUrl: VALUYA_BASE,
          tenantToken: VALUYA_TENANT_TOKEN,
          orderId: latestMarketplaceOrder.valuya_order_id,
          protocolSubjectHeader: latestMarketplaceOrder.protocol_subject_header,
        })
        await sendMarkdown(
          chatId,
          [
            formatMarketplaceStatusText({
              marketplaceOrder,
              storedOrder: latestMarketplaceOrder,
            }),
            "",
            ...(capacityText ? [capacityText, ""] : []),
            formatWhoamiText(who, subject),
          ].join("\n"),
        )
        return
      } catch (error) {
        logError("marketplace_order_status_error", error, {
          valuyaOrderId: latestMarketplaceOrder.valuya_order_id,
          localOrderId: latestMarketplaceOrder.local_order_id,
          protocolSubjectHeader: latestMarketplaceOrder.protocol_subject_header,
        })
      }
    }

    await sendMarkdown(
      chatId,
      [
        escapeMarkdownV2("✓ Bezahlt\\. Payment ist aktiv fuer Bestellbestaetigungen\\."),
        "",
        ...(capacityText ? [capacityText, ""] : []),
        formatWhoamiText(who, subject),
      ].join("\n"),
    )
    return
  }

  await sendMarkdown(
    chatId,
    [
      escapeMarkdownV2("Payment is still pending or inactive."),
      "",
      ...(capacityText ? [capacityText, ""] : []),
      formatWhoamiText(who, subject),
      "",
      escapeMarkdownV2("Tap confirm to let the agent execute payment again."),
    ].join("\n"),
  )
}

function parseCallback(data: string): ParsedCallback | null {
  if (data === "consent:allow") return { kind: "consent" }

  const match = /^(confirm|alt|cancel):(.+)$/.exec(data)
  if (!match) return null

  return {
    kind: "action",
    action: match[1] as "confirm" | "alt" | "cancel",
    orderId: match[2],
  }
}

async function handleStart(
  chatId: number,
  from: { id: number; username?: string },
  text: string,
): Promise<void> {
  const token = extractStartLinkToken(text)
  let redeemedSubject: AgentSubject | null = null
  if (token) {
    log("link_attempt", {
      telegramUserId: String(from.id),
      tokenPrefix: token.slice(0, 8),
    })
    const redeemed = await guardLinking.redeemLinkToken({
      telegramUserId: String(from.id),
      telegramUsername: from.username,
      linkToken: token,
    })
    if (redeemed.linked) {
      redeemedSubject = redeemed.subject
      log("link_success", {
        telegramUserId: String(from.id),
        source: redeemed.source,
        tenantId: redeemed.link.tenant_id,
        subjectType: redeemed.subject.type,
        protocolSubjectHeader: redeemed.link.valuya_protocol_subject_header || null,
        walletAddress: redeemed.link.valuya_linked_wallet_address || null,
        channelAppId: redeemed.link.channel_app_id,
      })
      await sendMarkdown(
        chatId,
        escapeMarkdownV2("Your Valuya account is now linked to this Telegram account."),
      )
    } else {
      log("link_failure", {
        telegramUserId: String(from.id),
        code: redeemed.code,
        reason: redeemed.message,
      })
      await sendMarkdown(chatId, escapeMarkdownV2(redeemed.message))
    }
  }

  let paymentSubject: AgentSubject | null = redeemedSubject
  if (paymentSubject) {
    log("guard_telegram_resolve_ignored_after_redeem_success", {
      tenant: tokenPreview(VALUYA_TENANT_TOKEN),
      channel_user_id: String(from.id),
      channel_app_id: TELEGRAM_CHANNEL_APP_ID,
      reason: "redeem_success_already_authoritative",
    })
  } else {
    paymentSubject = await resolveLinkedSubjectOrNull({
      telegramUserId: from.id,
      telegramUsername: from.username,
    })
  }
  const who = paymentSubject ? await whoamiForSubject(paymentSubject) : null
  const capacityText = paymentSubject ? await formatManagedCapacityText(paymentSubject) : ""
  await sendMarkdown(
    chatId,
    [
      escapeMarkdownV2("Willkommen bei Alfies Concierge auf Telegram."),
      escapeMarkdownV2("Ich kann Produkte suchen, Kategorien durchsuchen, Rezepte vorschlagen und Warenkoerbe zusammenstellen."),
      escapeMarkdownV2("Bestellbestaetigungen laufen weiter ueber den bestehenden Valuya Payment-Flow."),
      "",
      ...(capacityText ? [capacityText, ""] : []),
      ...(paymentSubject && who
        ? [formatWhoamiText(who, paymentSubject)]
        : [escapeMarkdownV2("Link your account via onboarding deep-link /start <token>.")]),
      "",
      escapeMarkdownV2("Beispiele: 'Milch', 'Getraenke fuer 6', 'Paella', 'Kategorien'."),
      "",
      escapeMarkdownV2("Tippe auf Consent, damit ich bestaetigte Bestellungen fuer dich ausfuehren darf."),
    ].join("\n"),
    {
      inline_keyboard: [
        [{ text: "✅ I consent", callback_data: "consent:allow" }],
      ],
    },
  )
}

async function ensureLinkedSubjectForPaymentAction(args: {
  chatId: number
  telegramUserId: number
  telegramUsername?: string
}): Promise<LinkedPurchaseContext | null> {
  const resolved = await guardLinking.ensureLinkedForPaymentAction({
    telegramUserId: String(args.telegramUserId),
    telegramUsername: args.telegramUsername,
  })
  if (!resolved.allowed) {
    await sendMarkdown(args.chatId, escapeMarkdownV2(resolved.reply))
    return null
  }
  const protocolSubjectHeader = String(resolved.link.valuya_protocol_subject_header || "").trim()
  if (!protocolSubjectHeader) {
    log("linked_protocol_subject_missing", {
      tenant: tokenPreview(VALUYA_TENANT_TOKEN),
      channel_user_id: String(args.telegramUserId),
      subjectHeader: null,
      principal_subject_type: null,
      principal_subject_id: null,
      wallet_address: null,
      wallet_source: "protocol_subject_missing_fail_safe",
      linked_privy_wallet_address: resolved.link.valuya_linked_wallet_address || null,
      guard_agent_wallet_address: null,
      resource: RESOURCE,
      plan: PLAN,
      error: "linked_protocol_subject_missing_fail_safe",
    })
    await sendMarkdown(
      args.chatId,
      escapeMarkdownV2("Linked Valuya protocol subject is missing. Please re-run onboarding link /start."),
    )
    return null
  }
  return {
    subject: resolved.subject,
    linkedPrivyWalletAddress: resolved.link.valuya_linked_wallet_address,
    protocolSubjectHeader,
    protocolSubjectType: resolved.link.valuya_protocol_subject_type,
    protocolSubjectId: resolved.link.valuya_protocol_subject_id,
    guardSubjectId: resolved.link.valuya_subject_id,
    guardSubjectType: resolved.link.valuya_subject_type,
    guardSubjectExternalId: resolved.link.valuya_subject_external_id,
  }
}

async function resolveLinkedSubjectOrNull(args: {
  telegramUserId: number
  telegramUsername?: string
}): Promise<AgentSubject | null> {
  const resolved = await guardLinking.resolveLinkedSubject({
    telegramUserId: String(args.telegramUserId),
    telegramUsername: args.telegramUsername,
  })
  return resolved.linked ? resolved.subject : null
}

async function sendConsentPrompt(chatId: number): Promise<void> {
  await sendMarkdown(
    chatId,
    escapeMarkdownV2("Please consent first before paid actions are executed."),
    {
      inline_keyboard: [
        [{ text: "✅ I consent", callback_data: "consent:allow" }],
      ],
    },
  )
}

async function whoamiForSubject(
  subject: AgentSubject,
): Promise<WhoamiResponse> {
  const path = "/api/v2/agent/whoami"
  const subjectId = `${subject.type}:${subject.id}`
  const headers: Record<string, string> = {
    Accept: "application/json",
  }
  if (subject.type && subject.id) {
    headers["X-Valuya-Subject-Id"] = subjectId
    headers["X-Valuya-Subject-Type"] = subject.type
    headers["X-Valuya-Subject-Id-Raw"] = subject.id
  }
  log("valuya_request_whoami", {
    tenant: tokenPreview(VALUYA_TENANT_TOKEN),
    subjectHeader: subjectId,
    resource: RESOURCE,
    plan: PLAN,
  })
  return apiJson<WhoamiResponse>({
    cfg,
    method: "GET",
    path,
    headers,
  })
}

async function getEntitlement(
  subject: AgentSubject,
): Promise<EntitlementDecision> {
  const path = `/api/v2/entitlements?plan=${encodeURIComponent(PLAN)}&resource=${encodeURIComponent(RESOURCE)}`
  const subjectId = `${subject.type}:${subject.id}`
  log("entitlement_request", {
    tenant: tokenPreview(VALUYA_TENANT_TOKEN),
    subjectId,
    subjectHeader: subjectId,
    resource: RESOURCE,
    plan: PLAN,
  })
  const result = await apiJson<EntitlementDecision>({
    cfg,
    method: "GET",
    path,
    headers: {
      "X-Valuya-Subject": subjectId,
      "X-Valuya-Subject-Id": subjectId,
      "X-Valuya-Subject-Type": subject.type,
      "X-Valuya-Subject-Id-Raw": subject.id,
      Accept: "application/json",
    },
  })
  log("entitlement_response", {
    subjectId,
    resource: RESOURCE,
    plan: PLAN,
    active: Boolean(result.active),
    reason: result.reason || null,
  })
  return result
}

async function waitForActiveEntitlement(args: {
  subjectId: string
  resource: string
  plan: string
  maxAttempts: number
  delaysMs: number[]
}): Promise<{ active: boolean; attempts: number; reason?: string }> {
  const subject = parseSubjectId(args.subjectId)
  let lastReason = "inactive"

  for (let attempt = 1; attempt <= args.maxAttempts; attempt++) {
    log("order_gate_entitlement_poll_attempt", {
      attempt,
      subjectId: args.subjectId,
      resource: args.resource,
      plan: args.plan,
    })

    const ent = await getEntitlement(subject)
    lastReason = ent.reason || lastReason
    if (ent.active) {
      log("order_gate_entitlement_active", {
        attempts: attempt,
        subjectId: args.subjectId,
        resource: args.resource,
        plan: args.plan,
      })
      return { active: true, attempts: attempt, reason: ent.reason }
    }

    const delay = args.delaysMs[Math.min(attempt - 1, args.delaysMs.length - 1)] ?? 0
    if (attempt < args.maxAttempts && delay > 0) {
      await sleep(delay)
    }
  }

  log("order_gate_timeout_no_mandate", {
    attempts: args.maxAttempts,
    subjectId: args.subjectId,
    resource: args.resource,
    plan: args.plan,
    reason: lastReason,
  })
  return { active: false, attempts: args.maxAttempts, reason: lastReason }
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

async function createMarketplaceOrderIntentForCheckout(args: {
  linked: LinkedPurchaseContext
  orderPayload: OrderPayload
  localOrderId: string
}): Promise<{ checkoutUrl: string; valuyaOrderId: string }> {
  const protocolSubjectHeader = String(args.linked.protocolSubjectHeader || "").trim()
  if (!protocolSubjectHeader) {
    throw new Error("linked_protocol_subject_missing_fail_safe")
  }

  const guardSubjectId = String(args.linked.guardSubjectId || "").trim()
  const guardSubjectType = String(args.linked.guardSubjectType || "").trim()
  const guardSubjectExternalId = String(args.linked.guardSubjectExternalId || "").trim()
  const guardSubject =
    guardSubjectId
      ? { id: guardSubjectId as string }
      : guardSubjectType && guardSubjectExternalId
        ? { type: guardSubjectType as string, external_id: guardSubjectExternalId as string }
        : null
  if (!guardSubject) {
    throw new Error("marketplace_guard_subject_missing_fail_safe")
  }

  const amountCents =
    toInt(args.orderPayload.meta?.total_cents) ||
    calculateOrderAmountCents(args.orderPayload.products)
  if (!amountCents || amountCents <= 0) {
    throw new Error("marketplace_amount_missing_fail_safe")
  }

  const cart = {
    items: args.orderPayload.products.map((p) => ({
      sku: p.sku,
      name: p.name,
      qty: p.qty,
      ...(typeof p.unit_price_cents === "number"
        ? { unit_price_cents: p.unit_price_cents }
        : {}),
    })),
  }

  const response = await createMarketplaceOrderIntent({
    baseUrl: VALUYA_BASE,
    tenantToken: VALUYA_TENANT_TOKEN,
    guardSubject,
    protocolSubjectHeader,
    productId: MARKETPLACE_PRODUCT_ID,
    merchantSlug: MARKETPLACE_MERCHANT_SLUG,
    channel: "telegram",
    resource: RESOURCE,
    plan: PLAN,
    amountCents,
    currency: DELEGATED_CURRENCY,
    asset: DELEGATED_ASSET,
    cart,
    localOrderId: args.localOrderId,
    logger: log,
  })

  const valuyaOrderId = String(response.order?.order_id || "").trim()
  const checkoutUrl = String(response.checkout_url || "").trim()
  if (!valuyaOrderId) {
    throw new Error("marketplace_order_id_missing_fail_safe")
  }
  if (!checkoutUrl) {
    throw new Error("marketplace_checkout_url_missing_fail_safe")
  }

  await marketplaceOrderStore.upsert(args.localOrderId, {
    valuya_order_id: valuyaOrderId,
    checkout_url: checkoutUrl,
    guard_subject_id: guardSubjectId || undefined,
    guard_subject_type: guardSubjectType || undefined,
    guard_subject_external_id: guardSubjectExternalId || undefined,
    protocol_subject_header: protocolSubjectHeader,
    amount_cents: amountCents,
    currency: DELEGATED_CURRENCY,
    status: String(response.order?.status || "awaiting_checkout"),
  })

  return { checkoutUrl, valuyaOrderId }
}

async function consumeUsage(params: {
  valuyaBase: string
  tenantToken: string
  subjectId: string
  resource: string
  plan: string
  orderId: string
}): Promise<{ status: number; ok: boolean; json: unknown; idem: string }> {
  const { valuyaBase, tenantToken, subjectId, resource, plan, orderId } = params
  const idem = `alfies-order:${orderId}:v1`
  const url = `${valuyaBase.replace(/\/+$/, "")}/api/v2/usage/consume`

  log("usage_consume_request", {
    tenant: tokenPreview(tenantToken),
    orderId,
    subjectId,
    subjectHeader: subjectId,
    principal_subject_type: parseSubjectId(subjectId).type,
    principal_subject_id: parseSubjectId(subjectId).id,
    wallet_address: null,
    resource,
    plan,
    idempotencyKey: idem,
  })

  const resp = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${tenantToken}`,
      "Content-Type": "application/json",
      Accept: "application/json",
      "X-Valuya-Subject-Id": subjectId,
      "X-Resource": resource,
      "X-Plan": plan,
      "Idempotency-Key": idem,
    },
    body: JSON.stringify({
      resource,
      plan,
      quantity: 1,
      idempotency_key: idem,
    }),
  })

  const json = await resp.json().catch(() => ({}))
  return {
    status: resp.status,
    ok: resp.ok && (json as any)?.ok !== false,
    json,
    idem,
  }
}

async function ensureEntitledViaAgent(args: {
  subject: AgentSubject
  subjectHeader: string
  linkedPrivyWalletAddress?: string
  orderId: string
  amountCents?: number
  cart?: unknown
  guardSubjectId?: string
  guardSubjectType?: string
  guardSubjectExternalId?: string
}): Promise<PaymentAttemptResult> {
  const subjectId = String(args.subjectHeader || "").trim()
  if (!subjectId) {
    log("linked_protocol_subject_missing", {
      tenant: tokenPreview(VALUYA_TENANT_TOKEN),
      subjectHeader: null,
      principal_subject_type: null,
      principal_subject_id: null,
      wallet_address: null,
      wallet_source: "protocol_subject_missing_fail_safe",
      linked_privy_wallet_address: normalizeWalletAddress(args.linkedPrivyWalletAddress) || null,
      guard_agent_wallet_address: null,
      resource: RESOURCE,
      plan: PLAN,
      orderId: args.orderId,
      error: "linked_protocol_subject_missing_fail_safe",
    })
    throw new Error("linked_protocol_subject_missing_fail_safe")
  }

  const before = await getEntitlement(args.subject)
  if (before.active) return { entitlement: before }

  const principal = canonicalPrincipalForAllowlist(subjectId)
  const guardSubjectId = String(args.guardSubjectId || "").trim()
  const guardSubjectType = String(args.guardSubjectType || "").trim()
  const guardSubjectExternalId = String(args.guardSubjectExternalId || "").trim()
  if (!guardSubjectId && (!guardSubjectType || !guardSubjectExternalId)) {
    log("delegated_payment_guard_subject_missing", {
      tenant: tokenPreview(VALUYA_TENANT_TOKEN),
      protocol_subject_header: subjectId,
      guard_subject_id: guardSubjectId || null,
      guard_subject_type: guardSubjectType || null,
      guard_subject_external_id: guardSubjectExternalId || null,
      error: "delegated_payment_guard_subject_missing_fail_safe",
    })
    throw new Error("delegated_payment_guard_subject_missing_fail_safe")
  }
  const who = await whoamiForSubject(args.subject)
  const linkedPrivyWallet =
    normalizeWalletAddress(args.linkedPrivyWalletAddress) ||
    extractLinkedPrivyWalletAddress(who)
  const guardAgentWallet = String(who.agent?.wallet_address || "").trim().toLowerCase()
  const walletSelection = linkedPrivyWallet
    ? { ok: true as const, walletAddress: linkedPrivyWallet, walletSource: "linked_privy_wallet" as const }
    : {
        ok: false as const,
        error: "linked_privy_wallet_missing_fail_safe" as const,
        message: `No linked Privy wallet available for ${subjectId}`,
      }

  log("legacy_signer_path_skipped", {
    tenant: tokenPreview(VALUYA_TENANT_TOKEN),
    subjectHeader: subjectId,
    principal_subject_type: principal.type,
    principal_subject_id: principal.id,
    wallet_address: null,
    wallet_source: "delegated_guard_payment",
    linked_privy_wallet_address: linkedPrivyWallet,
    guard_agent_wallet_address: guardAgentWallet || null,
    resource: RESOURCE,
    plan: PLAN,
    orderId: args.orderId,
    reason: "linked_user_purchase_uses_delegated_guard_flow",
  })

  if (!walletSelection.ok) {
    log("valuya_wallet_selection_failed", {
      tenant: tokenPreview(VALUYA_TENANT_TOKEN),
      subjectHeader: subjectId,
      principal_subject_type: principal.type,
      principal_subject_id: principal.id,
      wallet_address: null,
      wallet_source: "legacy_env_signer_blocked",
      linked_privy_wallet_address: linkedPrivyWallet,
      guard_agent_wallet_address: guardAgentWallet || null,
      resource: RESOURCE,
      plan: PLAN,
      error: walletSelection.error,
      message: walletSelection.message,
      todo: "Do not fallback to env signer for linked-user purchase.",
    })
    throw new Error(walletSelection.error)
  }

  const normalizedCart = normalizeMarketplaceCart(args.cart)
  const marketplaceOrder = await createMarketplaceOrder({
    baseUrl: VALUYA_BASE,
    tenantToken: VALUYA_TENANT_TOKEN,
    guardSubject: guardSubjectId
      ? { id: guardSubjectId }
      : { type: guardSubjectType, external_id: guardSubjectExternalId },
    protocolSubjectHeader: subjectId,
    productId: MARKETPLACE_PRODUCT_ID,
    merchantSlug: MARKETPLACE_MERCHANT_SLUG,
    channel: "telegram",
    resource: RESOURCE,
    plan: PLAN,
    amountCents: args.amountCents || calculateCartAmountCents(normalizedCart?.items) || 0,
    currency: DELEGATED_CURRENCY,
    asset: DELEGATED_ASSET,
    cart: normalizedCart,
    localOrderId: args.orderId,
    issueCheckoutToken: false,
    logger: log,
  })
  const valuyaOrderId = String(marketplaceOrder.order?.order_id || "").trim()
  if (!valuyaOrderId) {
    throw new Error("marketplace_order_id_missing_fail_safe")
  }

  const idem = `alfies-delegated:${args.orderId}:v1`
  try {
    const delegated = await requestDelegatedPayment({
      baseUrl: VALUYA_BASE,
      tenantToken: VALUYA_TENANT_TOKEN,
      protocolSubjectHeader: subjectId,
      guardSubjectId,
      guardSubjectType,
      guardSubjectExternalId,
      principalSubjectType: principal.type,
      principalSubjectId: principal.id,
      walletAddress: walletSelection.walletAddress,
      actorType: "agent",
      channel: "telegram",
      scope: DELEGATED_SCOPE,
      counterpartyType: DELEGATED_COUNTERPARTY_TYPE,
      counterpartyId: DELEGATED_COUNTERPARTY_ID,
      merchantOrderId: valuyaOrderId,
      currency: DELEGATED_CURRENCY,
      asset: DELEGATED_ASSET,
      idempotencyKey: idem,
      resource: RESOURCE,
      plan: PLAN,
      logger: log,
    })

    log("agent_purchase_delegated_success", {
      orderId: args.orderId,
      subjectId,
      idempotencyKey: idem,
      valuya_order_id: valuyaOrderId,
      response: delegated,
    })

    const delegatedRecord = delegated && typeof delegated === "object" ? (delegated as Record<string, unknown>) : {}
    const delegatedSession = readRecord(delegatedRecord.session)
    const delegatedState =
      readString(delegatedSession?.state) ||
      readString(delegatedRecord.state) ||
      ""
    const requiresStepup =
      delegatedSession?.requires_stepup === true ||
      delegatedRecord.requires_stepup === true
    if (delegatedState.toLowerCase() === "entitled") {
      return {
        entitlement: { active: true, reason: "entitled" },
        txHash: readString(delegatedRecord.tx_hash),
        chainId: toInt(delegatedRecord.chain_id),
        valuyaOrderId,
      }
    }
    if (delegatedState.toLowerCase() === "requires_stepup" || requiresStepup) {
      const checkout = await createMarketplaceCheckoutLink({
        baseUrl: VALUYA_BASE,
        tenantToken: VALUYA_TENANT_TOKEN,
        orderId: valuyaOrderId,
        protocolSubjectHeader: subjectId,
      })
      return {
        entitlement: { active: false, reason: "payment_required" },
        reason: "payment_stepup_required",
        checkoutUrl: String(checkout.checkout_url || "").trim() || undefined,
        valuyaOrderId,
      }
    }

    const after = await waitForActiveEntitlement({
      subjectId,
      resource: RESOURCE,
      plan: PLAN,
      maxAttempts: 4,
      delaysMs: [10_000, 20_000, 35_000, 60_000],
    })
    return {
      entitlement: { active: after.active, reason: after.reason },
      txHash: readString(delegatedRecord.tx_hash),
      chainId: toInt(delegatedRecord.chain_id),
      valuyaOrderId,
      ...(after.active
        ? {}
        : delegatedState.toLowerCase() === "pending_settlement"
          ? { reason: "pending_settlement" as const }
          : { reason: "retryable_failure" as const }),
    }
  } catch (error) {
    if (error instanceof DelegatedPaymentError) {
      const action = classifyDelegatedPaymentFailure(error)
      if (action === "checkout_required") {
        const checkout = await createMarketplaceCheckoutLink({
          baseUrl: VALUYA_BASE,
          tenantToken: VALUYA_TENANT_TOKEN,
          orderId: valuyaOrderId,
          protocolSubjectHeader: subjectId,
        })
        return {
          entitlement: { active: false, reason: "payment_required" },
          reason: "payment_stepup_required",
          checkoutUrl: String(checkout.checkout_url || "").trim() || undefined,
          valuyaOrderId,
        }
      }
      if (action === "topup_required") {
        return {
          entitlement: { active: false, reason: error.code || "payment_estimation_failed" },
          reason: "topup_required",
          topupUrl: error.topupUrl,
          valuyaOrderId,
        }
      }
      return {
        entitlement: { active: false, reason: error.code || "retryable_failure" },
        reason: "retryable_failure",
        valuyaOrderId,
      }
    }
    throw error
  }
}

function txExplorerUrl(txHash: string, chainId?: number): string | null {
  const h = String(txHash || "").trim()
  if (!h) return null
  if (chainId === 137 || chainId === undefined)
    return `https://polygonscan.com/tx/${h}`
  if (chainId === 80002) return `https://amoy.polygonscan.com/tx/${h}`
  return `https://polygonscan.com/tx/${h}`
}

function readMarketplaceTransaction(value: unknown): { txHash?: string; chainId?: number } | null {
  return readMarketplaceTransactionCore(value)
}

function buildTransactionLines(tx: { txHash?: string; chainId?: number } | null): string[] {
  return buildTransactionLinesCore({
    transaction: tx,
    language: "de",
  }).map((line, index) => index === 0 ? escapeMarkdownV2(line) : line)
}

function formatMarketplaceStatusText(args: {
  marketplaceOrder: unknown
  storedOrder: {
    external_order_id?: string
  }
}): string {
  const tx = readMarketplaceTransaction(args.marketplaceOrder)
  const externalOrderId = readString(args.storedOrder.external_order_id)
  const reply = buildPaymentConfirmedReplyCore({
    transaction: tx,
    submittedToMerchant: Boolean(externalOrderId),
    externalOrderId,
    language: "de",
  })
  return [
    ...reply.split("\n").map((line, index) => {
      if (line.startsWith("Explorer: ")) {
        const url = line.slice("Explorer: ".length).trim()
        return `[PolygonScan](${url})`
      }
      return escapeMarkdownV2(line)
    }),
    externalOrderId
      ? null
      : escapeMarkdownV2("Wenn du die Bestellung jetzt uebergeben willst, tippe erneut auf Confirm\\."),
  ].filter(Boolean).join("\n")
}

function canonicalPrincipalForAllowlist(subjectHeader: string): AgentSubject {
  const subject = parseSubjectId(subjectHeader)
  return {
    type: subject.type,
    id: subject.id,
  }
}

type ConciergePayload = {
  action: ConciergeAction
  orderId: string
  message?: string
  subject: AgentSubject
  channelContext: { type: "telegram"; id: number }
  cartState?: Record<string, unknown>
  actor_type?: "agent"
  channel?: "telegram"
}

async function callConciergeWithRetry(
  payload: ConciergePayload,
): Promise<ConciergeResponse> {
  const requestId = randomUUID()
  const subjectId = `${payload.subject.type}:${payload.subject.id}`

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      log("concierge_request", {
        requestId,
        orderId: payload.orderId,
        subjectId,
        action: payload.action,
        attempt,
      })

      const response = await fetch(N8N_WEBHOOK_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          "X-Request-Id": requestId,
        },
        body: JSON.stringify(payload),
      })

      const body = await safeParseJson(response)
      log("concierge_response", {
        requestId,
        orderId: payload.orderId,
        subjectId,
        action: payload.action,
        status: response.status,
      })

      if (!response.ok) {
        if (shouldRetryStatus(response.status) && attempt < MAX_RETRIES) {
          await sleep(backoffMs(attempt))
          continue
        }
        throw new Error(
          `concierge_http_${response.status}:${JSON.stringify(body).slice(0, 280)}`,
        )
      }

      return body as ConciergeResponse
    } catch (error) {
      if (attempt >= MAX_RETRIES) throw error
      await sleep(backoffMs(attempt))
    }
  }

  throw new Error("concierge_unreachable")
}

async function sendConciergeResponse(
  chatId: number,
  response: ConciergeResponse,
): Promise<void> {
  const text =
    response.telegram?.text?.trim() ||
    (Array.isArray(response.messages) ? response.messages.join("\n") : "Done.")

  const keyboard = toKeyboard(response.telegram?.keyboard)
  await sendMarkdown(chatId, escapeMarkdownV2(text), keyboard)
}

function updateOrderContextFromConcierge(response: ConciergeResponse): void {
  const orderId = String(response.orderId || "").trim()
  if (!orderId) return

  const current = orderContextByOrderId.get(orderId) || {}
  const next: OrderContext = { ...current }

  const recipeTitle = String(response.recipe?.title || "").trim()
  if (recipeTitle) next.recipeTitle = recipeTitle

  if (response.cart && typeof response.cart === "object") {
    const cart = response.cart as { items?: unknown; total_cents?: unknown }
    if (Array.isArray(cart.items)) next.cartItems = cart.items
    const totalCents = toInt(cart.total_cents)
    if (typeof totalCents === "number") next.totalCents = totalCents
  }

  orderContextByOrderId.set(orderId, next)
}

function buildOrderPayloadForBackend(orderId: string): OrderPayload {
  const ctx = orderContextByOrderId.get(orderId)
  return buildOrderPayload({
    orderId,
    resource: RESOURCE,
    plan: PLAN,
    cartItems: ctx?.cartItems,
    recipeTitle: ctx?.recipeTitle,
    totalCents: ctx?.totalCents,
  })
}

function smartSubjectId(telegramUserId: number, protocolSubjectHeader?: string): string {
  const canonical = String(protocolSubjectHeader || "").trim()
  return canonical || `telegram:${telegramUserId}`
}

async function sendOrderToBackend(
  orderPayload: OrderPayload,
  subjectId: string,
  usageIdempotencyKey?: string,
): Promise<unknown> {
  return sendOrderToBackendRequest({
    baseUrl: VALUYA_BACKEND_BASE_URL,
    token: VALUYA_BACKEND_TOKEN,
    subjectId,
    orderPayload,
    usageIdempotencyKey,
    log,
    maxRetries: 2,
    initialBackoffMs: INITIAL_BACKOFF_MS,
  })
}

function isOrderUsageProofRejected(
  error: unknown,
  usageProofKey?: string,
): boolean {
  if (!usageProofKey) return false
  if (!(error instanceof Error)) return false
  const details = (error as any).details
  return Number(details?.status) === 402
}

function extractOrderErrorDetails(error: unknown): unknown {
  if (error && typeof error === "object" && "details" in error) {
    return (error as any).details
  }
  if (error instanceof Error) return error.message
  return String(error)
}

function calculateOrderAmountCents(products: OrderPayload["products"]): number | undefined {
  if (!Array.isArray(products) || products.length === 0) return undefined
  let total = 0
  let hasLine = false
  for (const p of products) {
    const qty = toInt(p.qty) ?? 0
    const unit = toInt(p.unit_price_cents)
    if (qty > 0 && typeof unit === "number" && unit > 0) {
      total += qty * unit
      hasLine = true
    }
  }
  return hasLine ? total : undefined
}

function calculateCartAmountCents(items: unknown): number | undefined {
  if (!Array.isArray(items) || items.length === 0) return undefined
  let total = 0
  let hasLine = false
  for (const raw of items) {
    if (!raw || typeof raw !== "object") continue
    const item = raw as Record<string, unknown>
    const qty = toInt(item.qty) ?? 0
    const unit = toInt(item.unit_price_cents)
    if (qty > 0 && typeof unit === "number" && unit > 0) {
      total += qty * unit
      hasLine = true
    }
  }
  return hasLine ? total : undefined
}

function normalizeMarketplaceCart(input: unknown): { items: unknown[] } {
  if (input && typeof input === "object") {
    const obj = input as Record<string, unknown>
    if (Array.isArray(obj.items)) return { items: obj.items }
  }
  if (Array.isArray(input)) return { items: input }
  return { items: [] }
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null
}

function readString(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim()) return value.trim()
  return undefined
}

function classifyDelegatedPaymentFailure(error: DelegatedPaymentError): "checkout_required" | "topup_required" | "retryable_failure" {
  const marker = `${error.code} ${error.state} ${JSON.stringify(error.body).toLowerCase()}`
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

function toKeyboard(input: unknown): TelegramMarkup | undefined {
  if (!input) return undefined

  if (
    typeof input === "object" &&
    input !== null &&
    "inline_keyboard" in input
  ) {
    const markup = input as { inline_keyboard?: TelegramButton[][] }
    if (Array.isArray(markup.inline_keyboard))
      return { inline_keyboard: markup.inline_keyboard }
  }

  if (!Array.isArray(input)) return undefined
  if (input.length === 0) return undefined

  const first = input[0]
  if (Array.isArray(first)) {
    const rows = (input as unknown[])
      .map((row) =>
        Array.isArray(row) ? row.map(toButton).filter(Boolean) : [],
      )
      .filter((row): row is TelegramButton[] => row.length > 0)

    return rows.length > 0 ? { inline_keyboard: rows } : undefined
  }

  const row = (input as unknown[])
    .map(toButton)
    .filter((x): x is TelegramButton => Boolean(x))

  return row.length > 0 ? { inline_keyboard: [row] } : undefined
}

function toButton(raw: unknown): TelegramButton | undefined {
  if (!raw || typeof raw !== "object") return undefined
  const b = raw as { text?: unknown; url?: unknown; callback_data?: unknown }
  const text = String(b.text || "Action")
  if (typeof b.url === "string" && b.url) return { text, url: b.url }
  if (typeof b.callback_data === "string" && b.callback_data) {
    return { text, callback_data: b.callback_data }
  }
  return undefined
}

function formatWhoamiText(who: WhoamiResponse, subject: AgentSubject): string {
  const token = who.agent?.token_id || "n/a"
  const wallet = who.agent?.wallet_address || "n/a"
  const tenant = who.tenant?.slug || String(who.tenant?.id || "n/a")
  const principal = who.principal?.subject
    ? `${who.principal.subject.type || "?"}:${who.principal.subject.id || "?"}`
    : "n/a"
  const scopes = who.agent?.scopes?.length ? who.agent.scopes.join(", ") : "n/a"

  return [
    escapeMarkdownV2("Payment requested for:"),
    escapeMarkdownV2(`Tenant: ${tenant}`),
    escapeMarkdownV2(`Subject: ${subject.type}:${subject.id}`),
    escapeMarkdownV2(`Principal: ${principal}`),
    escapeMarkdownV2(`Agent token: ${token}`),
    escapeMarkdownV2(`Agent wallet: ${wallet}`),
    escapeMarkdownV2(`Scopes: ${scopes}`),
  ].join("\n")
}

async function formatManagedCapacityText(subject: AgentSubject): Promise<string> {
  const subjectHeader = `${subject.type}:${subject.id}`
  try {
    const response = await fetchManagedAgentCapacity({
      baseUrl: VALUYA_BASE,
      tenantToken: VALUYA_TENANT_TOKEN,
      subjectHeader,
      resource: CAPACITY_RESOURCE,
      plan: CAPACITY_PLAN,
      asset: DELEGATED_ASSET,
      currency: DELEGATED_CURRENCY,
      logger: log,
    })
    const summary = summarizeManagedAgentCapacity(response)
    return [
      escapeMarkdownV2("Managed agent capacity:"),
      escapeMarkdownV2(`Wallet balance: ${formatCapacityAmount(summary.walletBalanceCents, summary.currency)}`),
      escapeMarkdownV2(`Spendable overall: ${formatCapacityAmount(summary.overallSpendableCents, summary.currency)}`),
      escapeMarkdownV2(`Spendable for this bot now: ${formatCapacityAmount(summary.botSpendableNowCents, summary.currency)}`),
    ].join("\n")
  } catch (error) {
    logError("managed_agent_capacity_error", error, {
      subjectHeader,
      resource: CAPACITY_RESOURCE,
      plan: CAPACITY_PLAN,
    })
    return ""
  }
}

export function escapeMarkdownV2(input: string): string {
  return String(input).replace(/([_\*\[\]\(\)~`>#+\-=|{}.!\\])/g, "\\$1")
}

async function telegramCall<T>(
  method: string,
  payload: Record<string, unknown>,
): Promise<T> {
  const response = await fetch(`${TELEGRAM_API}/${method}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(payload),
  })

  const body = (await safeParseJson(response)) as Partial<
    TelegramApiResponse<T>
  >
  if (!response.ok || body.ok !== true) {
    throw new Error(
      `telegram_api_failed:${method}:${response.status}:${String(body.description || "unknown")}`,
    )
  }

  return body.result as T
}

async function sendMarkdown(
  chatId: number,
  text: string,
  keyboard?: TelegramMarkup,
): Promise<void> {
  const payload: Record<string, unknown> = {
    chat_id: chatId,
    text,
    parse_mode: "MarkdownV2",
  }
  if (keyboard) payload.reply_markup = keyboard
  await telegramCall("sendMessage", payload)
}

async function sendChatAction(
  chatId: number,
  action: "typing",
): Promise<void> {
  await telegramCall("sendChatAction", {
    chat_id: chatId,
    action,
  })
}

async function answerCallback(
  callbackQueryId: string,
  text: string,
): Promise<void> {
  await telegramCall("answerCallbackQuery", {
    callback_query_id: callbackQueryId,
    text,
  })
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

function shouldRetryStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500
}

function backoffMs(attempt: number): number {
  return INITIAL_BACKOFF_MS * Math.pow(2, attempt - 1)
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function toInt(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value))
    return Math.trunc(value)
  if (typeof value === "string" && value.trim()) {
    const n = Number(value)
    if (Number.isFinite(n)) return Math.trunc(n)
  }
  return undefined
}

function requiredEnv(name: string): string {
  const v = process.env[name]?.trim()
  if (!v) throw new Error(`${name}_required`)
  return v
}

function requiredPositiveInt(value: string | undefined, error: string): number {
  const n = toInt(value)
  if (typeof n !== "number" || n <= 0) throw new Error(error)
  return n
}

function loadEnvFromDotFile(): void {
  const envPath = resolve(process.cwd(), ".env")
  if (!existsSync(envPath)) return

  const lines = readFileSync(envPath, "utf8").split(/\r?\n/)
  for (const raw of lines) {
    const line = raw.trim()
    if (!line || line.startsWith("#")) continue
    const idx = line.indexOf("=")
    if (idx <= 0) continue
    const key = line.slice(0, idx).trim()
    const value = line.slice(idx + 1).trim()
    if (!key || process.env[key] !== undefined) continue
    process.env[key] = value
  }
}

function log(event: string, fields: Record<string, unknown>): void {
  console.log(JSON.stringify({ level: "info", event, ...fields }))
}

function tokenPreview(token: string): string {
  const value = String(token || "").trim()
  return value ? value.slice(0, 12) : "unknown"
}

function logError(
  event: string,
  error: unknown,
  fields: Record<string, unknown>,
): void {
  if (isValuyaApiError(error)) {
    const e = error as any
    console.error(
      JSON.stringify({
        level: "error",
        event,
        message: e.message,
        code: e.details.code,
        status: e.details.status,
        requestId: e.details.requestId,
        ...fields,
      }),
    )
    return
  }

  const message = error instanceof Error ? error.message : String(error)
  console.error(JSON.stringify({ level: "error", event, message, ...fields }))
}
