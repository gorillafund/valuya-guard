import { createServer } from "node:http"
import {
  createConfiguredSoul,
  createOptionalOpenAISoulRuntime,
  createOptionalWebhookSoulRuntime,
  normalizeChannelMode,
  normalizeSoulProvider,
  parseJsonHeaders,
} from "@valuya/bot-channel-bootstrap-core"
import {
  createOpenAIResponsesRunner,
  getRequestPath,
  handleInternalJsonMessage,
  loadEnvFile,
  requiredEnv,
} from "@valuya/bot-channel-server-core"
import { TelegramBotChannelApp } from "./app/TelegramBotChannelApp.js"
import { GuardTelegramChannelLinkResolver } from "./linking/GuardTelegramChannelLinkResolver.js"
import { FileSoulMemoryStore } from "./memory/FileSoulMemoryStore.js"
import { SchemaDrivenSoulRuntime } from "./runtime/SchemaDrivenSoulRuntime.js"
import { TelegramBotChannel } from "./runtime/TelegramBotChannel.js"
import { createMentorSoulDefinition } from "./souls/createMentorSoulDefinition.js"
import { WebhookSoulRuntime } from "@valuya/bot-channel-core"

loadEnvFile()

const PORT = Number(process.env.PORT || 8792)
const HOST = process.env.HOST?.trim() || "0.0.0.0"
const LINKS_FILE = requiredEnv("TELEGRAM_LINKS_FILE")
const VALUYA_BASE = requiredEnv("VALUYA_BASE").replace(/\/+$/, "")
const VALUYA_TENANT_TOKEN = requiredEnv("VALUYA_TENANT_TOKEN")
const TELEGRAM_CHANNEL_APP_ID = requiredEnv("TELEGRAM_CHANNEL_APP_ID")
const CHANNEL_PLAN = process.env.TELEGRAM_CHANNEL_PLAN?.trim() || "standard"
const CHANNEL_RESOURCE = process.env.TELEGRAM_CHANNEL_RESOURCE?.trim() || ""
const CHANNEL_BOT = process.env.TELEGRAM_CHANNEL_BOT?.trim() || ""
const CHANNEL_NAME = process.env.TELEGRAM_CHANNEL_NAME?.trim() || ""
const CHANNEL_INVITE_URL = process.env.TELEGRAM_CHANNEL_INVITE_URL?.trim() || ""
const SOUL_MEMORY_FILE = process.env.TELEGRAM_CHANNEL_MEMORY_FILE?.trim() || ".data/telegram-channel-memory.json"
const SOUL_ID = process.env.TELEGRAM_CHANNEL_SOUL_ID?.trim() || "mentor"
const SOUL_NAME = process.env.TELEGRAM_CHANNEL_SOUL_NAME?.trim() || "Mentor"
const SOUL_LOCALE = process.env.TELEGRAM_CHANNEL_SOUL_LOCALE?.trim() || "de"
const SOUL_SYSTEM_PROMPT = process.env.TELEGRAM_CHANNEL_SOUL_SYSTEM_PROMPT?.trim() || ""
const SOUL_RESPONSE_SCHEMA_JSON = process.env.TELEGRAM_CHANNEL_SOUL_RESPONSE_SCHEMA_JSON?.trim() || ""
const CHANNEL_MODE = normalizeChannelMode({
  value: process.env.TELEGRAM_CHANNEL_MODE,
  soulId: SOUL_ID,
})
const OPENAI_API_KEY = process.env.OPENAI_API_KEY?.trim() || ""
const OPENAI_MODEL = process.env.OPENAI_MODEL?.trim() || "gpt-4.1-mini"
const SOUL_PROVIDER = normalizeSoulProvider(process.env.TELEGRAM_CHANNEL_SOUL_PROVIDER)
const SOUL_WEBHOOK_URL = process.env.TELEGRAM_CHANNEL_SOUL_WEBHOOK_URL?.trim() || ""
const SOUL_WEBHOOK_AUTH_TOKEN = process.env.TELEGRAM_CHANNEL_SOUL_WEBHOOK_AUTH_TOKEN?.trim() || ""
const SOUL_WEBHOOK_TIMEOUT_MS = Number(process.env.TELEGRAM_CHANNEL_SOUL_WEBHOOK_TIMEOUT_MS || "30000")
const SOUL_WEBHOOK_HEADERS_JSON = process.env.TELEGRAM_CHANNEL_SOUL_WEBHOOK_HEADERS_JSON?.trim() || ""
const HUMAN_REPLY = process.env.TELEGRAM_CHANNEL_HUMAN_REPLY?.trim() || ""
const INTERNAL_API_TOKEN = process.env.TELEGRAM_CHANNEL_INTERNAL_API_TOKEN?.trim() || ""

const linkResolver = new GuardTelegramChannelLinkResolver({
  baseUrl: VALUYA_BASE,
  tenantToken: VALUYA_TENANT_TOKEN,
  channelAppId: TELEGRAM_CHANNEL_APP_ID,
  linksFile: LINKS_FILE,
})

const souls = CHANNEL_MODE.kind === "agent"
  ? [createConfiguredSoul({
    baseSoul: createMentorSoulDefinition({
      id: SOUL_ID,
      name: SOUL_NAME,
      locale: SOUL_LOCALE,
      ...(SOUL_SYSTEM_PROMPT ? { systemPrompt: SOUL_SYSTEM_PROMPT } : {}),
    }),
    responseSchemaJson: SOUL_RESPONSE_SCHEMA_JSON,
  })]
  : []

const soulRuntime = SOUL_PROVIDER === "webhook"
  ? createOptionalWebhookSoulRuntime({
    mode: CHANNEL_MODE,
    provider: SOUL_PROVIDER,
    url: SOUL_WEBHOOK_URL,
    authToken: SOUL_WEBHOOK_AUTH_TOKEN,
    timeoutMs: SOUL_WEBHOOK_TIMEOUT_MS,
    extraHeaders: parseJsonHeaders(SOUL_WEBHOOK_HEADERS_JSON),
    createRuntime: (args) => new WebhookSoulRuntime(args),
  })
  : createOptionalOpenAISoulRuntime({
    mode: CHANNEL_MODE,
    apiKey: OPENAI_API_KEY,
    model: OPENAI_MODEL,
    createRunner: createOpenAICompletionRunner,
    createRuntime: (args) => new SchemaDrivenSoulRuntime(args as ConstructorParameters<typeof SchemaDrivenSoulRuntime>[0]),
  })

const channel = new TelegramBotChannel({
  baseUrl: VALUYA_BASE,
  tenantToken: VALUYA_TENANT_TOKEN,
  channelResource: CHANNEL_RESOURCE || undefined,
  channelBot: CHANNEL_BOT || undefined,
  channelName: CHANNEL_NAME || undefined,
  channelPlan: CHANNEL_PLAN,
  channelInviteUrl: CHANNEL_INVITE_URL || undefined,
  mode: CHANNEL_MODE,
  souls,
  memoryStore: new FileSoulMemoryStore(SOUL_MEMORY_FILE),
  soulRuntime,
  humanReply: HUMAN_REPLY || undefined,
  linking: linkResolver,
})

const app = new TelegramBotChannelApp({
  channel,
  linkResolver,
})

const server = createServer(async (req, res) => {
  try {
    const requestPath = getRequestPath(req.url)
    if (req.method !== "POST" || requestPath !== "/internal/message") {
      res.writeHead(404, { "Content-Type": "application/json" })
      res.end(JSON.stringify({ ok: false, error: "not_found" }))
      return
    }

    const response = await handleInternalJsonMessage({
      req,
      internalApiToken: INTERNAL_API_TOKEN || undefined,
      providedToken: String(req.headers["x-agent-internal-token"] || "").trim() || null,
      onMessage: async (body) => app.handleInboundMessage({
        telegramUserId: normalizeTelegramUserId(String(body.telegramUserId || "")),
        body: String(body.body || ""),
        telegramUsername: typeof body.telegramUsername === "string" ? body.telegramUsername : undefined,
        locale: typeof body.locale === "string" ? body.locale : undefined,
      }),
    })

    res.writeHead(response.status, response.headers)
    res.end(response.body)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error(JSON.stringify({ level: "error", event: "telegram_bot_channel_error", message }))
    res.writeHead(500, { "Content-Type": "application/json" })
    res.end(JSON.stringify({ ok: false, error: "internal_error", message: "Temporary error. Please retry." }))
  }
})

server.listen(PORT, HOST, () => {
  console.log(JSON.stringify({
    level: "info",
    event: "telegram_bot_channel_started",
    host: HOST,
    port: PORT,
    internalPath: "/internal/message",
    channelMode: CHANNEL_MODE.kind,
    soulProvider: SOUL_PROVIDER,
    soulRuntimePresent: soulRuntime ? true : false,
    openaiConfigured: OPENAI_API_KEY ? true : false,
    openaiModel: OPENAI_MODEL || null,
    webhookConfigured: SOUL_WEBHOOK_URL ? true : false,
    resource: CHANNEL_RESOURCE || null,
    plan: CHANNEL_PLAN,
  }))
})

function createOpenAICompletionRunner(args: { apiKey: string; model: string }) {
  return createOpenAIResponsesRunner(args)
}

function normalizeTelegramUserId(raw: string): string {
  return String(raw || "").trim()
}
