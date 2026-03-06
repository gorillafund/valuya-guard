import { randomUUID } from "node:crypto"

const TELEGRAM_BOT_TOKEN = requireEnv("TELEGRAM_BOT_TOKEN")
const N8N_WEBHOOK_URL = resolveN8nWebhookUrl()
const VALUYA_BASE_URL = (
  process.env.VALUYA_BASE_URL?.trim() || "https://pay.gorilla.build"
).replace(/\/$/, "")
const VALUYA_TENANT_TOKEN = process.env.VALUYA_TENANT_TOKEN?.trim() || ""
const TELEGRAM_API = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}`

const RESOURCE =
  "telegram:bot:8748562521_aagildb2h9wfenj7uh5snityv-7zukwdj5o:recipe_confirm_alt_cancel_status"
const PLAN = "standard"
const MAX_RETRIES = 3
const INITIAL_BACKOFF_MS = 300
const TELEGRAM_POLL_TIMEOUT_SECONDS = 25
const WHOAMI_CACHE_TTL_MS = 5 * 60 * 1000

type BotAction = "recipe" | "confirm" | "alt" | "cancel" | "status"

type BotSubject = {
  type: "telegram"
  id: string
}

type N8nRequest = {
  resource: string
  plan: string
  subject: BotSubject
  action: BotAction
  message?: string
  orderId?: string
  dryRun?: boolean
  agentWhoami?: WhoamiSummary
}

type N8nPaymentRequired = {
  error: "payment_required"
  payment_url: string
  session_id: string
  expires_at?: string
  orderId?: string
}

type N8nSuccess = {
  ok: true
  orderId?: string
  telegram?: {
    text?: string
    keyboard?: unknown
  }
  recipe?: unknown
  cart?: unknown
}

type N8nResponse = {
  status: number
  body: unknown
  requestId: string
}

type InlineKeyboardButton = {
  text: string
  url?: string
  callback_data?: string
}

type InlineKeyboardMarkup = {
  inline_keyboard: InlineKeyboardButton[][]
}

type TelegramMessage = {
  message_id: number
  text?: string
  chat: {
    id: number
  }
  from?: {
    id: number
    username?: string
  }
}

type TelegramCallbackQuery = {
  id: string
  data?: string
  from: {
    id: number
    username?: string
  }
  message?: {
    message_id: number
    chat: {
      id: number
    }
  }
}

type TelegramUpdate = {
  update_id: number
  message?: TelegramMessage
  callback_query?: TelegramCallbackQuery
}

type TelegramApiResponse<T> = {
  ok: boolean
  result: T
  description?: string
}

type WhoamiSummary = {
  tokenId?: string
  principal?: string
  wallet?: string
  tenant?: string
  scopes?: string[]
}

const lastOrderByUser = new Map<string, string>()
const consentByUser = new Map<string, boolean>()
let whoamiCache: { value: WhoamiSummary | null; expiresAt: number } | null = null

void runBot()

async function runBot(): Promise<void> {
  logEvent("bot_started", {
    webhook: N8N_WEBHOOK_URL,
    resource: RESOURCE,
    plan: PLAN,
  })

  let offset = 0

  while (true) {
    try {
      const updates = await telegramCall<TelegramUpdate[]>("getUpdates", {
        timeout: TELEGRAM_POLL_TIMEOUT_SECONDS,
        offset,
        allowed_updates: ["message", "callback_query"],
      })

      for (const update of updates) {
        offset = update.update_id + 1
        await handleUpdate(update)
      }
    } catch (error) {
      logError("telegram_poll_error", error, {})
      await sleep(1000)
    }
  }
}

async function handleUpdate(update: TelegramUpdate): Promise<void> {
  if (update.message?.text) {
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

  if (text === "/start") {
    await sendStartMessage(message.chat.id, String(from.id))
    return
  }

  if (text === "/whoami") {
    await sendWhoamiMessage(message.chat.id)
    return
  }

  if (text === "/status") {
    await handleStatusCommand(message.chat.id, from.id)
    return
  }

  if (text.startsWith("/")) return

  const userId = String(from.id)
  if (!hasUserConsent(userId)) {
    await sendConsentPrompt(message.chat.id)
    return
  }

  const existingOrderId = lastOrderByUser.get(userId)
  const orderId = existingOrderId || randomUUID()
  lastOrderByUser.set(userId, orderId)
  const whoami = await getWhoamiSummarySafe()

  const payload: N8nRequest = {
    resource: RESOURCE,
    plan: PLAN,
    subject: toSubject(from.id),
    action: "recipe",
    message: text,
    orderId,
    agentWhoami: whoami || undefined,
  }

  try {
    const result = await callN8nWithRetry(payload)
    await handleN8nResponse(message.chat.id, userId, result)
  } catch (error) {
    logError("message_error", error, {
      orderId,
      textPreview: text.slice(0, 60),
    })
    await sendMessage(
      message.chat.id,
      "I hit a temporary error processing that. Please retry.",
    )
  }
}

async function handleStatusCommand(
  chatId: number,
  telegramUserId: number,
): Promise<void> {
  const userId = String(telegramUserId)
  const orderId = lastOrderByUser.get(userId)

  const primaryPayload: N8nRequest = {
    resource: RESOURCE,
    plan: PLAN,
    subject: toSubject(telegramUserId),
    action: "status",
    orderId,
  }

  try {
    const statusResult = await callN8nWithRetry(primaryPayload)
    if (statusResult.status === 200 || statusResult.status === 402) {
      await handleN8nResponse(chatId, userId, statusResult)
      return
    }

    if (isStatusUnsupported(statusResult.status, statusResult.body)) {
      const fallbackPayload: N8nRequest = {
        resource: RESOURCE,
        plan: PLAN,
        subject: toSubject(telegramUserId),
        action: "confirm",
        dryRun: true,
        orderId,
      }
      const fallbackResult = await callN8nWithRetry(fallbackPayload)
      await handleN8nResponse(chatId, userId, fallbackResult)
      return
    }

    logEvent("status_failed", {
      requestId: statusResult.requestId,
      orderId,
      status: statusResult.status,
    })
    await sendMessage(
      chatId,
      "I could not verify payment status right now. Please retry in a moment.",
    )
  } catch (error) {
    logError("status_error", error, { orderId })
    await sendMessage(
      chatId,
      "I hit a temporary error checking status. Please try /status again.",
    )
  }
}

async function handleCallback(query: TelegramCallbackQuery): Promise<void> {
  const data = query.data || ""
  const parsed = parseCallbackData(data)

  if (!parsed) {
    await answerCallbackQuery(query.id, "Unsupported action.")
    return
  }

  const chatId = query.message?.chat.id
  if (!chatId) {
    await answerCallbackQuery(query.id, "Missing chat context.")
    return
  }

  if (parsed.kind === "consent") {
    consentByUser.set(String(query.from.id), true)
    await answerCallbackQuery(query.id, "Consent saved")
    await sendMessage(
      chatId,
      "Consent recorded. You can now send a dish and I will execute paid actions on your behalf.",
    )
    return
  }

  if (!hasUserConsent(String(query.from.id))) {
    await answerCallbackQuery(query.id, "Please consent first.")
    await sendConsentPrompt(chatId)
    return
  }

  const whoami = await getWhoamiSummarySafe()

  const payload: N8nRequest = {
    resource: RESOURCE,
    plan: PLAN,
    subject: toSubject(query.from.id),
    action: parsed.action,
    orderId: parsed.orderId,
    agentWhoami: whoami || undefined,
  }

  try {
    const result = await callN8nWithRetry(payload)
    await handleN8nResponse(chatId, String(query.from.id), result)
    await answerCallbackQuery(query.id, "Updated")
  } catch (error) {
    logError("callback_error", error, {
      orderId: parsed.orderId,
      action: parsed.action,
    })
    await answerCallbackQuery(query.id, "Temporary error. Please retry.")
    await sendMessage(chatId, "I hit a temporary error. Please try again.")
  }
}

function toSubject(telegramUserId: number): BotSubject {
  return { type: "telegram", id: String(telegramUserId) }
}

async function callN8nWithRetry(payload: N8nRequest): Promise<N8nResponse> {
  const requestId = randomUUID()
  const orderId = payload.orderId

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      logEvent("n8n_request", {
        requestId,
        orderId,
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
      logEvent("n8n_response", {
        requestId,
        orderId,
        action: payload.action,
        status: response.status,
        attempt,
      })

      if (shouldRetryStatus(response.status) && attempt < MAX_RETRIES) {
        await sleep(backoffMs(attempt))
        continue
      }

      return {
        status: response.status,
        body,
        requestId,
      }
    } catch (error) {
      const retrying = attempt < MAX_RETRIES
      logError("n8n_network_error", error, {
        requestId,
        orderId,
        action: payload.action,
        attempt,
        retrying,
      })

      if (!retrying) throw error
      await sleep(backoffMs(attempt))
    }
  }

  throw new Error("n8n_unreachable")
}

async function handleN8nResponse(
  chatId: number,
  userId: string,
  result: N8nResponse,
): Promise<void> {
  if (result.status === 402) {
    const body = result.body as Partial<N8nPaymentRequired>
    const paymentUrl = String(body.payment_url || "")
    const orderId = body.orderId

    if (orderId) {
      lastOrderByUser.set(userId, orderId)
    }

    const text =
      "Payment is required before I can continue. Tap the button below, then type /status after paying."

    if (!paymentUrl) {
      await sendMessage(
        chatId,
        `${text} I could not retrieve a payment URL, please try again.`,
      )
      return
    }

    await sendMessage(chatId, text, {
      inline_keyboard: [[{ text: "Pay now", url: paymentUrl }]],
    })
    return
  }

  if (result.status === 200) {
    const body = result.body as N8nSuccess
    const orderId = body.orderId
    if (orderId) {
      lastOrderByUser.set(userId, orderId)
    }

    const text = body.telegram?.text?.trim() || "Done."
    const keyboard = toInlineKeyboard(body.telegram?.keyboard)

    await sendMessage(chatId, text, keyboard)
    return
  }

  logEvent("n8n_unhandled_status", {
    requestId: result.requestId,
    status: result.status,
  })
  await sendMessage(chatId, "I could not process that right now. Please retry.")
}

function toInlineKeyboard(input: unknown): InlineKeyboardMarkup | undefined {
  if (!input) return undefined

  if (
    typeof input === "object" &&
    input !== null &&
    "inline_keyboard" in input
  ) {
    const maybeMarkup = input as { inline_keyboard?: InlineKeyboardButton[][] }
    if (Array.isArray(maybeMarkup.inline_keyboard)) {
      return { inline_keyboard: maybeMarkup.inline_keyboard }
    }
  }

  if (!Array.isArray(input)) return undefined
  if (input.length === 0) return undefined

  const first = input[0]
  if (Array.isArray(first)) {
    const rows = (input as unknown[])
      .map((row) =>
        Array.isArray(row) ? row.map(convertButton).filter(Boolean) : [],
      )
      .filter((row): row is InlineKeyboardButton[] => row.length > 0)

    return rows.length > 0 ? { inline_keyboard: rows } : undefined
  }

  const singleRow = (input as unknown[])
    .map(convertButton)
    .filter((button): button is InlineKeyboardButton => Boolean(button))

  return singleRow.length > 0 ? { inline_keyboard: [singleRow] } : undefined
}

function convertButton(raw: unknown): InlineKeyboardButton | undefined {
  if (!raw || typeof raw !== "object") return undefined

  const input = raw as {
    text?: unknown
    url?: unknown
    callback_data?: unknown
    action?: unknown
    orderId?: unknown
  }

  const text = String(input.text || "Action")

  if (typeof input.url === "string" && input.url) {
    return { text, url: input.url }
  }

  if (typeof input.callback_data === "string" && input.callback_data) {
    return { text, callback_data: input.callback_data }
  }

  if (typeof input.action === "string" && typeof input.orderId === "string") {
    return { text, callback_data: `${input.action}:${input.orderId}` }
  }

  return undefined
}

function parseCallbackData(
  data: string,
):
  | { kind: "workflow"; action: "confirm" | "alt" | "cancel"; orderId: string }
  | { kind: "consent"; decision: "allow" }
  | null {
  if (data === "consent:allow") {
    return { kind: "consent", decision: "allow" }
  }

  const match = /^(confirm|alt|cancel):(.+)$/.exec(data)
  if (!match) return null

  return {
    kind: "workflow",
    action: match[1] as "confirm" | "alt" | "cancel",
    orderId: match[2],
  }
}

function isStatusUnsupported(status: number, body: unknown): boolean {
  if (status === 404 || status === 405) return true
  if (!body || typeof body !== "object") return false

  const errorValue =
    "error" in body ? (body as { error?: unknown }).error : undefined
  return errorValue === "unknown_action" || errorValue === "not_implemented"
}

function shouldRetryStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500
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

async function sendMessage(
  chatId: number,
  text: string,
  keyboard?: InlineKeyboardMarkup,
): Promise<void> {
  const payload: Record<string, unknown> = {
    chat_id: chatId,
    text,
  }

  if (keyboard) {
    payload.reply_markup = keyboard
  }

  await telegramCall("sendMessage", payload)
}

async function answerCallbackQuery(
  callbackQueryId: string,
  text: string,
): Promise<void> {
  await telegramCall("answerCallbackQuery", {
    callback_query_id: callbackQueryId,
    text,
  })
}

function backoffMs(attempt: number): number {
  return INITIAL_BACKOFF_MS * Math.pow(2, attempt - 1)
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function requireEnv(name: string): string {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`${name}_required`)
  return value
}

function resolveN8nWebhookUrl(): string {
  const explicit = process.env.N8N_WEBHOOK_URL?.trim()
  if (explicit) {
    return explicit.replace(/\/$/, "")
  }

  const base = requireEnv("N8N_BASE_URL")
  return `${base.replace(/\/$/, "")}/webhook/valuya/agent/run`
}

function hasUserConsent(userId: string): boolean {
  return consentByUser.get(userId) === true
}

async function sendStartMessage(chatId: number, userId: string): Promise<void> {
  const whoami = await getWhoamiSummarySafe()
  const lines = [
    "Hi, I am Alfies Concierge.",
    "I can propose recipes and run payment-gated actions.",
    "",
    ...formatWhoamiLines(whoami),
    "",
    hasUserConsent(userId)
      ? "Consent already recorded. Send a dish to continue."
      : "Please confirm consent before I execute paid actions.",
  ]

  const keyboard = hasUserConsent(userId)
    ? undefined
    : {
        inline_keyboard: [
          [{ text: "✅ I consent to agent payments", callback_data: "consent:allow" }],
        ],
      }

  await sendMessage(chatId, lines.join("\n"), keyboard)
}

async function sendWhoamiMessage(chatId: number): Promise<void> {
  const whoami = await getWhoamiSummarySafe()
  await sendMessage(chatId, formatWhoamiLines(whoami).join("\n"))
}

async function sendConsentPrompt(chatId: number): Promise<void> {
  await sendMessage(
    chatId,
    "Please confirm consent before I execute paid actions.",
    {
      inline_keyboard: [
        [{ text: "✅ I consent to agent payments", callback_data: "consent:allow" }],
      ],
    },
  )
}

function formatWhoamiLines(whoami: WhoamiSummary | null): string[] {
  if (!whoami) {
    return [
      "Agent identity: unavailable",
      "Set VALUYA_TENANT_TOKEN (and optionally VALUYA_BASE_URL) to enable /whoami.",
    ]
  }

  return [
    "Agent identity:",
    `- token: ${whoami.tokenId || "n/a"}`,
    `- principal: ${whoami.principal || "n/a"}`,
    `- wallet: ${whoami.wallet || "n/a"}`,
    `- tenant: ${whoami.tenant || "n/a"}`,
    `- scopes: ${(whoami.scopes && whoami.scopes.length > 0) ? whoami.scopes.join(", ") : "n/a"}`,
  ]
}

async function getWhoamiSummarySafe(): Promise<WhoamiSummary | null> {
  try {
    return await getWhoamiSummary()
  } catch (error) {
    logError("whoami_error", error, {})
    return null
  }
}

async function getWhoamiSummary(): Promise<WhoamiSummary | null> {
  if (!VALUYA_TENANT_TOKEN) return null

  const now = Date.now()
  if (whoamiCache && now < whoamiCache.expiresAt) {
    return whoamiCache.value
  }

  const value = await fetchWhoamiWithRetry()
  whoamiCache = { value, expiresAt: now + WHOAMI_CACHE_TTL_MS }
  return value
}

async function fetchWhoamiWithRetry(): Promise<WhoamiSummary | null> {
  const url = `${VALUYA_BASE_URL}/api/v2/agent/whoami`
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const response = await fetch(url, {
        method: "GET",
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${VALUYA_TENANT_TOKEN}`,
        },
      })

      const body = await safeParseJson(response)
      if (!response.ok) {
        if (shouldRetryStatus(response.status) && attempt < MAX_RETRIES) {
          await sleep(backoffMs(attempt))
          continue
        }
        throw new Error(`whoami_failed:${response.status}:${JSON.stringify(body).slice(0, 300)}`)
      }

      return normalizeWhoami(body)
    } catch (error) {
      if (attempt >= MAX_RETRIES) throw error
      await sleep(backoffMs(attempt))
    }
  }

  return null
}

function normalizeWhoami(raw: unknown): WhoamiSummary {
  const b = (raw && typeof raw === "object") ? (raw as Record<string, unknown>) : {}
  const principalObj = readRecord(b.principal) || readRecord(b.subject)
  const principalType = readString(principalObj?.type)
  const principalId = readString(principalObj?.id)
  const scopes = readStringArray(b.scopes)

  return {
    tokenId:
      readString(b.token_id) ||
      readString(b.agent_token_id) ||
      readString(b.id),
    principal: (principalType && principalId) ? `${principalType}:${principalId}` : undefined,
    wallet:
      readString(b.wallet_address) ||
      readString(readRecord(b.wallet)?.address),
    tenant:
      readString(readRecord(b.tenant)?.slug) ||
      readString(b.tenant_id),
    scopes: scopes.length > 0 ? scopes : undefined,
  }
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null
}

function readString(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim()) return value.trim()
  if (typeof value === "number") return String(value)
  return undefined
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .map((v) => (typeof v === "string" ? v.trim() : ""))
    .filter((v) => v.length > 0)
}

function logEvent(event: string, fields: Record<string, unknown>): void {
  console.log(JSON.stringify({ level: "info", event, ...fields }))
}

function logError(
  event: string,
  error: unknown,
  fields: Record<string, unknown>,
): void {
  const message = error instanceof Error ? error.message : String(error)
  console.error(JSON.stringify({ level: "error", event, message, ...fields }))
}
