import { createServer } from "node:http"
import { resolve } from "node:path"
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
  resolveRequestUrl,
  readRequestBody,
} from "@valuya/bot-channel-server-core"
import {
  isValidTwilioSignature,
  parseTwilioForm,
  sendOutboundWhatsAppMessage,
  twimlMessage,
} from "./transport/twilio.js"
import { WhatsAppBotChannelApp } from "./app/WhatsAppBotChannelApp.js"
import { GuardWhatsAppChannelLinkResolver } from "./linking/GuardWhatsAppChannelLinkResolver.js"
import { FileSoulMemoryStore } from "./memory/FileSoulMemoryStore.js"
import { SchemaDrivenSoulRuntime } from "./runtime/SchemaDrivenSoulRuntime.js"
import { WhatsAppBotChannel } from "./runtime/WhatsAppBotChannel.js"
import { createMentorSoulDefinition } from "./souls/createMentorSoulDefinition.js"
import { WebhookSoulRuntime } from "@valuya/bot-channel-core"

loadEnvFile()

const PORT = Number(process.env.PORT || 8791)
const HOST = process.env.HOST?.trim() || "0.0.0.0"
const STATE_FILE = process.env.WHATSAPP_STATE_FILE?.trim() || resolve(process.cwd(), ".data/whatsapp-state.sqlite")
const VALUYA_BASE = requiredEnv("VALUYA_BASE").replace(/\/+$/, "")
const VALUYA_TENANT_TOKEN = requiredEnv("VALUYA_TENANT_TOKEN")
const WHATSAPP_CHANNEL_APP_ID = requiredEnv("WHATSAPP_CHANNEL_APP_ID")
const CHANNEL_PLAN = process.env.WHATSAPP_CHANNEL_PLAN?.trim() || "standard"
const CHANNEL_RESOURCE = process.env.WHATSAPP_CHANNEL_RESOURCE?.trim() || ""
const CHANNEL_PROVIDER = process.env.WHATSAPP_CHANNEL_PROVIDER?.trim() || "meta"
const CHANNEL_IDENTIFIER = process.env.WHATSAPP_CHANNEL_IDENTIFIER?.trim() || ""
const CHANNEL_PHONE_NUMBER = process.env.WHATSAPP_CHANNEL_PHONE_NUMBER?.trim() || ""
const CHANNEL_VISIT_URL = process.env.WHATSAPP_CHANNEL_VISIT_URL?.trim() || ""
const SOUL_MEMORY_FILE = process.env.WHATSAPP_CHANNEL_MEMORY_FILE?.trim() || ".data/whatsapp-channel-memory.json"
const SOUL_ID = process.env.WHATSAPP_CHANNEL_SOUL_ID?.trim() || "mentor"
const SOUL_NAME = process.env.WHATSAPP_CHANNEL_SOUL_NAME?.trim() || "Mentor"
const SOUL_LOCALE = process.env.WHATSAPP_CHANNEL_SOUL_LOCALE?.trim() || "de"
const SOUL_SYSTEM_PROMPT = process.env.WHATSAPP_CHANNEL_SOUL_SYSTEM_PROMPT?.trim() || ""
const SOUL_RESPONSE_SCHEMA_JSON = process.env.WHATSAPP_CHANNEL_SOUL_RESPONSE_SCHEMA_JSON?.trim() || ""
const CHANNEL_MODE = normalizeChannelMode({
  value: process.env.WHATSAPP_CHANNEL_MODE,
  soulId: SOUL_ID,
})
const OPENAI_API_KEY = process.env.OPENAI_API_KEY?.trim() || ""
const OPENAI_MODEL = process.env.OPENAI_MODEL?.trim() || "gpt-4.1-mini"
const SOUL_PROVIDER = normalizeSoulProvider(process.env.WHATSAPP_CHANNEL_SOUL_PROVIDER)
const SOUL_WEBHOOK_URL = process.env.WHATSAPP_CHANNEL_SOUL_WEBHOOK_URL?.trim() || ""
const SOUL_WEBHOOK_AUTH_TOKEN = process.env.WHATSAPP_CHANNEL_SOUL_WEBHOOK_AUTH_TOKEN?.trim() || ""
const SOUL_WEBHOOK_TIMEOUT_MS = Number(process.env.WHATSAPP_CHANNEL_SOUL_WEBHOOK_TIMEOUT_MS || "30000")
const SOUL_WEBHOOK_HEADERS_JSON = process.env.WHATSAPP_CHANNEL_SOUL_WEBHOOK_HEADERS_JSON?.trim() || ""
const HUMAN_REPLY = process.env.WHATSAPP_CHANNEL_HUMAN_REPLY?.trim() || ""
const INTERNAL_API_TOKEN = process.env.WHATSAPP_CHANNEL_INTERNAL_API_TOKEN?.trim() || ""
const TWILIO_VALIDATE_SIGNATURE = String(process.env.TWILIO_VALIDATE_SIGNATURE || "false").toLowerCase() === "true"
const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID?.trim() || ""
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN?.trim() || ""
const TWILIO_WHATSAPP_NUMBER = process.env.TWILIO_WHATSAPP_NUMBER?.trim() || ""
const TWILIO_WEBHOOK_PUBLIC_URL = process.env.TWILIO_WEBHOOK_PUBLIC_URL?.trim() || ""
const THINKING_MESSAGE = process.env.WHATSAPP_CHANNEL_THINKING_MESSAGE?.trim() || "Ich denke kurz nach und melde mich sofort mit einer guten Antwort."
const STILL_THINKING_MESSAGE = process.env.WHATSAPP_CHANNEL_STILL_THINKING_MESSAGE?.trim() || "Ich bin noch kurz dran."
const THINKING_FOLLOWUP_MS = Number(process.env.WHATSAPP_CHANNEL_THINKING_FOLLOWUP_MS || "5000")

const linkResolver = new GuardWhatsAppChannelLinkResolver({
  baseUrl: VALUYA_BASE,
  tenantToken: VALUYA_TENANT_TOKEN,
  channelAppId: WHATSAPP_CHANNEL_APP_ID,
  stateFile: STATE_FILE,
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

const channel = new WhatsAppBotChannel({
  baseUrl: VALUYA_BASE,
  tenantToken: VALUYA_TENANT_TOKEN,
  channelResource: CHANNEL_RESOURCE || undefined,
  channelProvider: CHANNEL_PROVIDER || undefined,
  channelIdentifier: CHANNEL_IDENTIFIER || undefined,
  channelPhoneNumber: CHANNEL_PHONE_NUMBER || undefined,
  channelPlan: CHANNEL_PLAN,
  channelVisitUrl: CHANNEL_VISIT_URL || undefined,
  mode: CHANNEL_MODE,
  souls,
  memoryStore: new FileSoulMemoryStore(SOUL_MEMORY_FILE),
  soulRuntime,
  humanReply: HUMAN_REPLY || undefined,
  linking: linkResolver,
})

const app = new WhatsAppBotChannelApp({
  channel,
  linkResolver,
})

const ASYNC_THINKING_ENABLED = Boolean(TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN && soulRuntime)

const server = createServer(async (req, res) => {
  try {
    const requestPath = getRequestPath(req.url)
    if (req.method === "POST" && requestPath === "/internal/message") {
      const response = await handleInternalJsonMessage({
        req,
        internalApiToken: INTERNAL_API_TOKEN || undefined,
        providedToken: String(req.headers["x-agent-internal-token"] || "").trim() || null,
        onMessage: async (body) => app.handleInboundMessage({
          whatsappUserId: normalizeWhatsAppUserId(String(body.whatsappUserId || "")),
          body: String(body.body || ""),
          profileName: typeof body.profileName === "string" ? body.profileName : undefined,
          locale: typeof body.locale === "string" ? body.locale : undefined,
        }),
      })
      res.writeHead(response.status, response.headers)
      res.end(response.body)
      return
    }

    if (req.method !== "POST" || requestPath !== "/twilio/whatsapp/webhook") {
      res.writeHead(404, { "Content-Type": "application/json" })
      res.end(JSON.stringify({ ok: false, error: "not_found" }))
      return
    }

    const rawBody = await readRequestBody(req)
    const parsed = parseTwilioForm(rawBody)
    const requestUrl = TWILIO_WEBHOOK_PUBLIC_URL || resolveRequestUrl({
      headers: req.headers as Record<string, string | string[] | undefined>,
      url: req.url,
    })

    if (TWILIO_VALIDATE_SIGNATURE) {
      if (!TWILIO_AUTH_TOKEN) throw new Error("TWILIO_AUTH_TOKEN_required")
      const valid = isValidTwilioSignature({
        authToken: TWILIO_AUTH_TOKEN,
        signatureHeader: req.headers["x-twilio-signature"]?.toString() || null,
        url: requestUrl,
        params: parsed.params,
      })
      if (!valid) {
        res.writeHead(403, { "Content-Type": "application/xml; charset=utf-8" })
        res.end(twimlMessage("Invalid Twilio signature."))
        return
      }
    }

    if (ASYNC_THINKING_ENABLED) {
      void processAsyncWhatsAppReply({
        from: parsed.from,
        to: parsed.to || TWILIO_WHATSAPP_NUMBER,
        body: parsed.body,
        profileName: parsed.profileName,
        messageSid: parsed.messageSid,
      })
      res.writeHead(200, { "Content-Type": "application/xml; charset=utf-8" })
      res.end(twimlMessage(THINKING_MESSAGE))
      return
    }

    const result = await app.handleInboundMessage({
      whatsappUserId: normalizeWhatsAppUserId(parsed.from),
      body: parsed.body,
      profileName: parsed.profileName,
    })

    res.writeHead(200, { "Content-Type": "application/xml; charset=utf-8" })
    res.end(twimlMessage(result.reply))
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error(JSON.stringify({ level: "error", event: "whatsapp_bot_channel_error", message }))
    res.writeHead(500, { "Content-Type": "application/xml; charset=utf-8" })
    res.end(twimlMessage("Temporärer Fehler. Bitte in 10 Sekunden erneut versuchen."))
  }
})

server.listen(PORT, HOST, () => {
  console.log(JSON.stringify({
    level: "info",
    event: "whatsapp_bot_channel_started",
    host: HOST,
    port: PORT,
    webhookPath: "/twilio/whatsapp/webhook",
    channelMode: CHANNEL_MODE.kind,
    configuredSoulIds: souls.map((soul) => soul.id),
    soulRuntimePresent: soulRuntime ? true : false,
    asyncThinkingEnabled: ASYNC_THINKING_ENABLED,
    soulProvider: SOUL_PROVIDER,
    openaiConfigured: OPENAI_API_KEY ? true : false,
    openaiModel: OPENAI_MODEL || null,
    webhookConfigured: SOUL_WEBHOOK_URL ? true : false,
    stateFile: STATE_FILE,
    resource: CHANNEL_RESOURCE || null,
    plan: CHANNEL_PLAN,
  }))
})

function createOpenAICompletionRunner(args: { apiKey: string; model: string }) {
  return createOpenAIResponsesRunner(args)
}

function normalizeWhatsAppUserId(raw: string): string {
  const value = String(raw || "").trim()
  const withoutPrefix = value.startsWith("whatsapp:") ? value.slice("whatsapp:".length) : value
  return withoutPrefix.replace(/\s+/g, "").replace(/^\+/, "").replace(/[^\d]/g, "")
}

async function processAsyncWhatsAppReply(args: {
  from: string
  to: string
  body: string
  profileName?: string
  messageSid?: string
}): Promise<void> {
  const outboundFrom = String(args.to || TWILIO_WHATSAPP_NUMBER || "").trim()
  if (!outboundFrom) {
    console.error(JSON.stringify({
      level: "error",
      event: "whatsapp_bot_channel_async_reply_error",
      message: "twilio_from_number_missing",
    }))
    return
  }

  let completed = false
  let followupSent = false
  const followupTimer = setTimeout(() => {
    if (completed || !STILL_THINKING_MESSAGE.trim()) return
    followupSent = true
    void sendOutboundWhatsAppMessage({
      accountSid: TWILIO_ACCOUNT_SID,
      authToken: TWILIO_AUTH_TOKEN,
      from: outboundFrom,
      to: args.from,
      body: STILL_THINKING_MESSAGE,
    }).catch((error) => {
      console.error(JSON.stringify({
        level: "error",
        event: "whatsapp_bot_channel_async_followup_error",
        message: error instanceof Error ? error.message : String(error),
        messageSid: args.messageSid || null,
      }))
    })
  }, Math.max(0, THINKING_FOLLOWUP_MS))

  try {
    const result = await app.handleInboundMessage({
      whatsappUserId: normalizeWhatsAppUserId(args.from),
      body: args.body,
      profileName: args.profileName,
    })
    completed = true
    clearTimeout(followupTimer)

    await sendOutboundWhatsAppMessage({
      accountSid: TWILIO_ACCOUNT_SID,
      authToken: TWILIO_AUTH_TOKEN,
      from: outboundFrom,
      to: args.from,
      body: result.reply,
    })

    console.log(JSON.stringify({
      level: "info",
      event: "whatsapp_bot_channel_async_reply_sent",
      messageSid: args.messageSid || null,
      followupSent,
      replyPreview: result.reply.slice(0, 120),
    }))
  } catch (error) {
    completed = true
    clearTimeout(followupTimer)
    const message = error instanceof Error ? error.message : String(error)
    console.error(JSON.stringify({
      level: "error",
      event: "whatsapp_bot_channel_async_reply_error",
      message,
      messageSid: args.messageSid || null,
    }))
    try {
      await sendOutboundWhatsAppMessage({
        accountSid: TWILIO_ACCOUNT_SID,
        authToken: TWILIO_AUTH_TOKEN,
        from: outboundFrom,
        to: args.from,
        body: "Temporärer Fehler. Bitte in 10 Sekunden erneut versuchen.",
      })
    } catch {}
  }
}
