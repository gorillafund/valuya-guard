import { randomUUID } from "node:crypto"
import { existsSync, readFileSync } from "node:fs"
import { resolve } from "node:path"
import type { AgentConfig, AgentSubject } from "@valuya/agent"
import {
  apiJson,
  createProvider,
  isValuyaApiError,
  makeEthersSigner,
  purchase,
  sendErc20Transfer,
} from "@valuya/agent"
import {
  buildOrderPayload,
  sendOrderToBackendRequest,
  type OrderPayload,
} from "./orderBackend.js"

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
const VALUYA_PRIVATE_KEY = requiredEnv("VALUYA_PRIVATE_KEY")
const VALUYA_RPC_URL = requiredEnv("VALUYA_RPC_URL")

const TELEGRAM_API = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}`
const N8N_WEBHOOK_URL = `${N8N_BASE_URL}${N8N_WEBHOOK_PATH.startsWith("/") ? "" : "/"}${N8N_WEBHOOK_PATH}`

const RESOURCE =
  process.env.VALUYA_RESOURCE?.trim() ||
  "telegram:bot:8748562521_aagildb2h9wfenj7uh5snityv-7zukwdj5o:recipe_confirm_alt_cancel_status"
const PLAN = process.env.VALUYA_PLAN?.trim() || "standard"
const MAX_RETRIES = 3
const INITIAL_BACKOFF_MS = 300
const POLL_TIMEOUT_SECONDS = 25
const VALUYA_POLL_INTERVAL_MS = Number(process.env.VALUYA_POLL_INTERVAL ?? 3000)
const VALUYA_POLL_TIMEOUT_MS = Number(process.env.VALUYA_POLL_TIMEOUT ?? 60000)

const cfg: AgentConfig = {
  base: VALUYA_BASE,
  tenant_token: VALUYA_TENANT_TOKEN,
}
const signer = makeEthersSigner(
  VALUYA_PRIVATE_KEY,
  createProvider(VALUYA_RPC_URL),
)

const consentByUser = new Map<string, boolean>()
const orderContextByOrderId = new Map<string, OrderContext>()

if (PLAN.toLowerCase() === "free") {
  throw new Error("VALUYA_PLAN_free_not_allowed")
}

void run()

async function run(): Promise<void> {
  log("bot_started", {
    webhook: N8N_WEBHOOK_URL,
    valuyaBase: VALUYA_BASE,
    backendBaseUrl: VALUYA_BACKEND_BASE_URL,
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

  if (text === "/start") {
    await sendStart(chatId, from.id)
    return
  }

  if (text === "/status") {
    await handleStatus(chatId, from.id)
    return
  }

  if (text === "/whoami") {
    const paymentSubject = await resolvePaymentSubject(from.id)
    const who = await whoamiForSubject(paymentSubject)
    await sendMarkdown(chatId, formatWhoamiText(who, paymentSubject))
    return
  }

  if (text.startsWith("/")) return

  if (!consentByUser.get(userId)) {
    await sendConsentPrompt(chatId)
    return
  }

  // DEV NOTE: force a new random order_id for every order request.
  // TODO: double-check final order_id strategy before production.
  const orderId = randomUUID()

  await sendChatAction(chatId, "typing")

  const response = await callConciergeWithRetry({
    action: "recipe",
    orderId,
    message: text,
    subject: { type: "telegram", id: from.id },
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
      escapeMarkdownV2("Consent recorded. You can place orders now."),
    )
    return
  }

  if (!consentByUser.get(userId)) {
    await answerCallback(query.id, "Please consent first")
    await sendConsentPrompt(chatId)
    return
  }

  const resolvedPaymentSubject = await resolvePaymentSubject(telegramUserId)
  const resolvedCanonicalSubject = `${resolvedPaymentSubject.type}:${resolvedPaymentSubject.id}`

  await sendChatAction(chatId, "typing")

  if (parsed.action === "confirm") {
    const who = await whoamiForSubject(resolvedPaymentSubject)
    let paymentResult: {
      entitlement: EntitlementDecision
      txHash?: string
      chainId?: number
    }
    try {
      paymentResult = await ensureEntitledViaAgent({
        subject: resolvedPaymentSubject,
        orderId: parsed.orderId,
      })
    } catch (error) {
      logError("agent_purchase_error", error, {
        orderId: parsed.orderId,
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
      await answerCallback(query.id, "Payment not active")
      await sendMarkdown(
        chatId,
        [
          escapeMarkdownV2(
            "Automatic agent payment failed or is still pending.",
          ),
          "",
          formatWhoamiText(who, resolvedPaymentSubject),
          "",
          escapeMarkdownV2("Run /status and try confirm again."),
        ].join("\n"),
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
  }

  if (parsed.action === "confirm") {
    const backendSubjectId = resolvedCanonicalSubject
    const orderPayload = buildOrderPayloadForBackend(parsed.orderId)
    let usageProofKey: string | undefined
    log("confirm_flow_start", {
      orderId: orderPayload.order_id,
      subjectId: backendSubjectId,
      resource: RESOURCE,
      plan: PLAN,
    })

    try {
      // A) wait for active mandate after verify
      const gate = await waitForActiveEntitlement({
        subjectId: backendSubjectId,
        resource: RESOURCE,
        plan: PLAN,
        maxAttempts: 6,
        delaysMs: [400, 800, 1500, 2500, 4000, 6000],
      })
      if (!gate.active) {
        await sendMarkdown(
          chatId,
          escapeMarkdownV2(
            "Zahlung noch ausstehend. Bitte kurz warten und /status erneut prüfen.",
          ),
        )
        await sendPaymentRequiredMessage(
          chatId,
          resolvedPaymentSubject,
          orderPayload.order_id,
        )
        return
      }

      // B) usage consume first
      const consume = await consumeUsage({
        valuyaBase: VALUYA_BASE,
        tenantToken: VALUYA_TENANT_TOKEN,
        subjectId: backendSubjectId,
        resource: RESOURCE,
        plan: PLAN,
        orderId: orderPayload.order_id,
      })
      usageProofKey = consume.idem

      log("usage_consume_response", {
        orderId: orderPayload.order_id,
        subjectId: backendSubjectId,
        resource: RESOURCE,
        plan: PLAN,
        status: consume.status,
        ok: consume.ok,
        idempotencyKey: consume.idem,
        body: consume.json,
      })

      if (!consume.ok || (consume.json as any)?.ok === false) {
        log("confirm_blocked_by_usage", {
          orderId: orderPayload.order_id,
          subjectId: backendSubjectId,
          reason: (consume.json as any)?.error || "usage_consume_failed",
          details: consume.json,
        })
        if (
          consume.status === 402 ||
          (consume.json as any)?.error === "payment_required"
        ) {
          await sendPaymentRequiredMessage(
            chatId,
            resolvedPaymentSubject,
            orderPayload.order_id,
          )
        } else if (consume.status === 403) {
          await sendMarkdown(
            chatId,
            escapeMarkdownV2(
              "Zahlung konnte nicht geprüft werden (Scope fehlt). Bitte Support kontaktieren.",
            ),
          )
        } else {
          await sendMarkdown(
            chatId,
            escapeMarkdownV2(
              "Zahlung konnte nicht verbucht werden. Bitte erneut versuchen.",
            ),
          )
        }
        return
      }

      // C) now safe: n8n confirm
      const response = await callConciergeWithRetry({
        action: "confirm",
        orderId: parsed.orderId,
        subject: { type: "telegram", id: telegramUserId },
      })

      await answerCallback(query.id, "Updated")
      updateOrderContextFromConcierge(response)
      await sendConciergeResponse(chatId, response)

      // D) submit order
      log("order_usage_proof_attached", {
        orderId: orderPayload.order_id,
        usageProofKey,
      })
      log("order_request_sent", {
        orderId: orderPayload.order_id,
        subjectId: backendSubjectId,
        resource: RESOURCE,
        plan: PLAN,
      })
      await sendOrderToBackend(orderPayload, backendSubjectId, usageProofKey)

      await sendMarkdown(
        chatId,
        [
          escapeMarkdownV2(
            "Ich habe folgende Bestelldaten an das Valuya Backend gesendet (für E-Mail Versand):",
          ),
          escapeMarkdownV2(`- Bestellung: ${orderPayload.order_id}`),
          escapeMarkdownV2("- Kundennummer: 89733"),
          escapeMarkdownV2("- Lieferadresse: Kaiserstrasse 8/7a, 1070 Wien"),
          escapeMarkdownV2("- Lieferung: sofort"),
          escapeMarkdownV2(
            `- Produkte: ${orderPayload.products.length} Positionen (CSV wird als Anhang per E-Mail mitgesendet)`,
          ),
          escapeMarkdownV2("Empfänger: manuel@31third.com"),
        ].join("\n"),
      )
    } catch (error) {
      if (isOrderUsageProofRejected(error, usageProofKey)) {
        log("order_usage_proof_rejected", {
          orderId: orderPayload.order_id,
          subjectId: backendSubjectId,
          usageProofKey,
          error: extractOrderErrorDetails(error),
        })
        await sendMarkdown(
          chatId,
          escapeMarkdownV2(
            `Bestellung konnte nicht finalisiert werden (402 trotz Usage-Proof). Bitte /status ausführen und erneut bestätigen. Diagnose: order=${orderPayload.order_id}, proof=${usageProofKey}`,
          ),
        )
        return
      }
      await sendOrderFailedMessage(
        chatId,
        orderPayload.order_id,
        backendSubjectId,
        error,
      )
    }
    return
  }

  const response = await callConciergeWithRetry({
    action: parsed.action,
    orderId: parsed.orderId,
    subject: { type: "telegram", id: telegramUserId },
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
  subject: AgentSubject,
  orderId: string,
): Promise<void> {
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

  const session = await createCheckoutSessionForSubject(
    subject,
    ent.required || { type: "subscription", plan: PLAN },
  )

  await sendMarkdown(
    chatId,
    escapeMarkdownV2(
      "Zahlung/Top-up erforderlich. Bitte über den Button bezahlen und danach erneut bestätigen.",
    ),
    {
      inline_keyboard: [
        [{ text: "Top up / Pay", url: session.payment_url }],
        [{ text: "🔁 Erneut bestätigen", callback_data: `confirm:${orderId}` }],
      ],
    },
  )
}

async function handleStatus(
  chatId: number,
  telegramUserId: number,
): Promise<void> {
  const subject = await resolvePaymentSubject(telegramUserId)
  const entitlement = await getEntitlement(subject)
  const who = await whoamiForSubject(subject)

  if (entitlement.active) {
    await sendMarkdown(
      chatId,
      [
        escapeMarkdownV2("Payment is active for order confirmations."),
        "",
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

function subjectForPayments(telegramUserId: number): AgentSubject {
  // Canonical subject string remains <type>:<id> and uses stable per-user identity.
  return { type: "user", id: String(telegramUserId) }
}

async function sendStart(
  chatId: number,
  telegramUserId: number,
): Promise<void> {
  const paymentSubject = await resolvePaymentSubject(telegramUserId)
  const who = await whoamiForSubject(paymentSubject)
  await sendMarkdown(
    chatId,
    [
      escapeMarkdownV2("Welcome to Alfies Concierge."),
      escapeMarkdownV2("I can suggest recipes and mock carts."),
      escapeMarkdownV2("Order confirmation is payment-gated via Valuya Agent."),
      "",
      formatWhoamiText(who, paymentSubject),
      "",
      escapeMarkdownV2("Tap consent to allow agent-driven payment requests."),
    ].join("\n"),
    {
      inline_keyboard: [
        [{ text: "✅ I consent", callback_data: "consent:allow" }],
      ],
    },
  )
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
  const headers: Record<string, string> = {
    Accept: "application/json",
  }
  if (subject.type && subject.id) {
    headers["X-Valuya-Subject-Id"] = `${subject.type}:${subject.id}`
    headers["X-Valuya-Subject-Type"] = subject.type
    headers["X-Valuya-Subject-Id-Raw"] = subject.id
  }
  return apiJson<WhoamiResponse>({
    cfg,
    method: "GET",
    path,
    headers,
  })
}

async function resolvePaymentSubject(
  telegramUserId: number,
): Promise<AgentSubject> {
  const fallback = subjectForPayments(telegramUserId)
  try {
    // Resolve principal bound to tenant token first; this is the canonical payment subject.
    const who = await apiJson<WhoamiResponse>({
      cfg,
      method: "GET",
      path: "/api/v2/agent/whoami",
      headers: { Accept: "application/json" },
    })
    const principal = who.principal?.subject
    const type = String(principal?.type || "").trim()
    const id = String(principal?.id || "").trim()
    if (type && id) {
      log("payment_subject_resolved", {
        source: "whoami_principal",
        telegramUserId: String(telegramUserId),
        subjectId: `${type}:${id}`,
      })
      return { type, id }
    }
  } catch (error) {
    logError("payment_subject_resolve_error", error, {
      telegramUserId: String(telegramUserId),
    })
  }

  log("payment_subject_resolved", {
    source: "telegram_fallback",
    telegramUserId: String(telegramUserId),
    subjectId: `${fallback.type}:${fallback.id}`,
  })
  return fallback
}

async function getEntitlement(
  subject: AgentSubject,
): Promise<EntitlementDecision> {
  const path = `/api/v2/entitlements?plan=${encodeURIComponent(PLAN)}&resource=${encodeURIComponent(RESOURCE)}`
  const subjectId = `${subject.type}:${subject.id}`
  log("entitlement_request", {
    subjectId,
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

async function createCheckoutSessionForSubject(
  subject: AgentSubject,
  required: { type: string; plan?: string; [k: string]: unknown },
): Promise<{ payment_url: string; session_id: string }> {
  const subjectId = `${subject.type}:${subject.id}`
  return apiJson({
    cfg,
    method: "POST",
    path: "/api/v2/checkout/sessions",
    headers: {
      "X-Valuya-Subject": subjectId,
      "X-Valuya-Subject-Id": subjectId,
      "X-Valuya-Subject-Type": subject.type,
      "X-Valuya-Subject-Id-Raw": subject.id,
      Accept: "application/json",
    },
    body: {
      resource: RESOURCE,
      plan: PLAN,
      evaluated_plan: PLAN,
      subject,
      principal: subject,
      required,
      mode: "agent",
    },
  })
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
    orderId,
    subjectId,
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
  orderId: string
}): Promise<{
  entitlement: EntitlementDecision
  txHash?: string
  chainId?: number
}> {
  const before = await getEntitlement(args.subject)
  if (before.active) return { entitlement: before }

  const required = before.required || { type: "subscription", plan: PLAN }
  const subjectId = `${args.subject.type}:${args.subject.id}`

  const result = await purchase({
    cfg,
    signer,
    subject: args.subject,
    principal: args.subject,
    resource: RESOURCE,
    plan: PLAN,
    required: required as any,
    pollIntervalMs: VALUYA_POLL_INTERVAL_MS,
    pollTimeoutMs: VALUYA_POLL_TIMEOUT_MS,
    sendTx: async (payment) => {
      if (payment.method !== "onchain") {
        throw new Error(`unsupported_payment_method:${payment.method}`)
      }
      return sendErc20Transfer({ signer, payment })
    },
  })

  log("payment_required", {
    orderId: args.orderId,
    subjectId,
    sessionId: result.session.session_id,
    paymentRequiredResponse: result.session,
  })

  log("agent_purchase_success", {
    orderId: args.orderId,
    subjectId,
    sessionId: result.session.session_id,
    txHash: result.tx_hash,
    paymentInstruction: result.session.payment,
    submit: result.submit,
    verify: result.verify,
  })

  if ((result.verify as any)?.ok === true && (result.verify as any)?.state === "confirmed") {
    log("order_gate_verify_confirmed", {
      orderId: args.orderId,
      subjectId,
      sessionId: result.session.session_id,
      state: (result.verify as any)?.state,
    })
  }

  const after = await getEntitlement(args.subject)
  const chainId =
    result.session.payment &&
    typeof (result.session.payment as any).chain_id === "number"
      ? Number((result.session.payment as any).chain_id)
      : undefined
  return { entitlement: after, txHash: result.tx_hash, chainId }
}

function txExplorerUrl(txHash: string, chainId?: number): string | null {
  const h = String(txHash || "").trim()
  if (!h) return null
  if (chainId === 137 || chainId === undefined)
    return `https://polygonscan.com/tx/${h}`
  if (chainId === 80002) return `https://amoy.polygonscan.com/tx/${h}`
  return `https://polygonscan.com/tx/${h}`
}

type ConciergePayload = {
  action: ConciergeAction
  orderId: string
  message?: string
  subject: { type: "telegram"; id: number }
  cartState?: Record<string, unknown>
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

async function sendOrderToBackend(
  orderPayload: OrderPayload,
  subjectId: string,
  usageIdempotencyKey?: string,
): Promise<void> {
  await sendOrderToBackendRequest({
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
