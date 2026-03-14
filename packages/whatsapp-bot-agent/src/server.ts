import { createServer } from "node:http"
import { parseTwilioForm, isValidTwilioSignature, twimlMessage } from "../../whatsapp-bot/dist/whatsapp-bot/src/twilio.js"
import { FileStateStore } from "../../whatsapp-bot/dist/whatsapp-bot/src/stateStore.js"
import { BackendAlfiesCheckoutAdapter } from "./adapters/BackendAlfiesCheckoutAdapter.js"
import { FileConversationStoreAdapter } from "./adapters/FileConversationStoreAdapter.js"
import { GuardWhatsAppLinkResolverAdapter } from "./adapters/GuardWhatsAppLinkResolverAdapter.js"
import { SharedStateCatalogPortAdapter } from "./adapters/SharedStateCatalogPortAdapter.js"
import { SharedStateCartPortAdapter } from "./adapters/SharedStateCartPortAdapter.js"
import { SharedStateCartMutationPortAdapter } from "./adapters/SharedStateCartMutationPortAdapter.js"
import { ValuyaPaymentGatewayAdapter } from "./adapters/ValuyaPaymentGatewayAdapter.js"
import { WhatsAppBotAgentApp } from "./app/WhatsAppBotAgentApp.js"
import { OpenAIShoppingPlanner } from "./runtime/OpenAIShoppingPlanner.js"
import { SimpleCheckoutAgentRuntime } from "./runtime/SimpleCheckoutAgentRuntime.js"
import { CommerceToolRegistry } from "./tools/CommerceToolRegistry.js"

const PORT = Number(process.env.PORT || 8789)
const HOST = process.env.HOST?.trim() || "0.0.0.0"
const STATE_FILE = requiredEnv("WHATSAPP_STATE_FILE")
const VALUYA_BASE = requiredEnv("VALUYA_BASE").replace(/\/+$/, "")
const VALUYA_TENANT_TOKEN = requiredEnv("VALUYA_TENANT_TOKEN")
const VALUYA_BACKEND_BASE_URL = requiredEnv("VALUYA_BACKEND_BASE_URL").replace(/\/+$/, "")
const VALUYA_BACKEND_TOKEN = requiredEnv("VALUYA_BACKEND_TOKEN")
const VALUYA_ORDER_RESOURCE = requiredEnv("VALUYA_ORDER_RESOURCE")
const VALUYA_PLAN = process.env.VALUYA_PLAN?.trim() || "standard"
const MARKETPLACE_PRODUCT_ID = Number(requiredEnv("MARKETPLACE_PRODUCT_ID"))
const MARKETPLACE_MERCHANT_SLUG = process.env.MARKETPLACE_MERCHANT_SLUG?.trim() || "alfies"
const WHATSAPP_CHANNEL_APP_ID = process.env.WHATSAPP_CHANNEL_APP_ID?.trim() || "whatsapp_main"
const INTERNAL_API_TOKEN = process.env.WHATSAPP_AGENT_INTERNAL_API_TOKEN?.trim() || ""
const TWILIO_VALIDATE_SIGNATURE = String(process.env.TWILIO_VALIDATE_SIGNATURE || "false").toLowerCase() === "true"
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN?.trim() || ""
const TWILIO_WEBHOOK_PUBLIC_URL = process.env.TWILIO_WEBHOOK_PUBLIC_URL?.trim() || ""
const OPENAI_API_KEY = process.env.OPENAI_API_KEY?.trim() || ""
const OPENAI_MODEL = process.env.OPENAI_MODEL?.trim() || "gpt-4.1-mini"

const paymentGateway = new ValuyaPaymentGatewayAdapter({
  baseUrl: VALUYA_BASE,
  tenantToken: VALUYA_TENANT_TOKEN,
  resource: VALUYA_ORDER_RESOURCE,
  plan: VALUYA_PLAN,
  productId: MARKETPLACE_PRODUCT_ID,
  merchantSlug: MARKETPLACE_MERCHANT_SLUG,
  channel: "whatsapp",
})

const alfiesCheckout = new BackendAlfiesCheckoutAdapter({
  baseUrl: VALUYA_BACKEND_BASE_URL,
  token: VALUYA_BACKEND_TOKEN,
  resource: VALUYA_ORDER_RESOURCE,
  plan: VALUYA_PLAN,
  source: "whatsapp",
})

const app = new WhatsAppBotAgentApp({
  agentRuntime: new SimpleCheckoutAgentRuntime({
    planner: OPENAI_API_KEY
      ? new OpenAIShoppingPlanner({
        apiKey: OPENAI_API_KEY,
        model: OPENAI_MODEL,
      })
      : undefined,
  }),
  conversationStore: new FileConversationStoreAdapter(STATE_FILE),
  linkResolver: new GuardWhatsAppLinkResolverAdapter({
    baseUrl: VALUYA_BASE,
    tenantToken: VALUYA_TENANT_TOKEN,
    channelAppId: WHATSAPP_CHANNEL_APP_ID,
    stateFile: STATE_FILE,
  }),
  toolRegistry: new CommerceToolRegistry({
    cartStatePort: new SharedStateCartPortAdapter(STATE_FILE),
    catalogPort: new SharedStateCatalogPortAdapter(STATE_FILE),
    cartMutationPort: new SharedStateCartMutationPortAdapter(STATE_FILE),
    paymentGateway,
    alfiesCheckout,
    defaultResource: VALUYA_ORDER_RESOURCE,
    defaultPlan: VALUYA_PLAN,
  }),
})

const server = createServer(async (req, res) => {
  try {
    const requestPath = getRequestPath(req.url)
    if (req.method === "POST" && requestPath === "/internal/message") {
      if (INTERNAL_API_TOKEN) {
        const provided = String(req.headers["x-agent-internal-token"] || "").trim()
        if (provided !== INTERNAL_API_TOKEN) {
          res.writeHead(401, { "Content-Type": "application/json" })
          res.end(JSON.stringify({ ok: false, error: "unauthorized" }))
          return
        }
      }

      const body = await parseJsonBody(req)
      const result = await app.handleInboundMessage({
        whatsappUserId: normalizeWhatsAppUserId(String(body.whatsappUserId || "")),
        body: String(body.body || ""),
        profileName: typeof body.profileName === "string" ? body.profileName : undefined,
      })
      logPlannerOutcome({
        source: "internal",
        whatsappUserId: normalizeWhatsAppUserId(String(body.whatsappUserId || "")),
        message: String(body.body || ""),
        reply: result.reply,
        metadata: result.metadata,
      })
      res.writeHead(200, { "Content-Type": "application/json" })
      res.end(JSON.stringify({ ok: true, reply: result.reply, metadata: result.metadata || {} }))
      return
    }

    if (req.method !== "POST" || requestPath !== "/twilio/whatsapp/webhook") {
      res.writeHead(404, { "Content-Type": "application/json" })
      res.end(JSON.stringify({ ok: false, error: "not_found" }))
      return
    }

    const rawBody = await readRequestBody(req)
    const parsed = parseTwilioForm(rawBody)
    const requestUrl = TWILIO_WEBHOOK_PUBLIC_URL || resolveRequestUrl(req)

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

    const result = await app.handleInboundMessage({
      whatsappUserId: normalizeWhatsAppUserId(parsed.from),
      body: parsed.body,
      profileName: parsed.profileName,
    })
    logPlannerOutcome({
      source: "twilio",
      whatsappUserId: normalizeWhatsAppUserId(parsed.from),
      message: parsed.body,
      reply: result.reply,
      metadata: result.metadata,
    })

    res.writeHead(200, { "Content-Type": "application/xml; charset=utf-8" })
    res.end(twimlMessage(result.reply))
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error(JSON.stringify({ level: "error", event: "whatsapp_bot_agent_error", message }))
    res.writeHead(500, { "Content-Type": "application/xml; charset=utf-8" })
    res.end(twimlMessage("Temporärer Fehler. Bitte in 10 Sekunden erneut versuchen."))
  }
})

server.listen(PORT, HOST, () => {
  console.log(JSON.stringify({
    level: "info",
    event: "whatsapp_bot_agent_started",
    host: HOST,
    port: PORT,
    webhookPath: "/twilio/whatsapp/webhook",
    resource: VALUYA_ORDER_RESOURCE,
    plan: VALUYA_PLAN,
    stateFile: STATE_FILE,
  }))
  void logCatalogHealth(STATE_FILE)
})

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`${name}_required`)
  return value
}

function getRequestPath(rawUrl?: string | null): string {
  if (!rawUrl) return "/"
  try {
    return new URL(rawUrl, "http://localhost").pathname
  } catch {
    return "/"
  }
}

async function readRequestBody(req: any): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)))
  }
  return Buffer.concat(chunks).toString("utf8")
}

async function parseJsonBody(req: any): Promise<Record<string, unknown>> {
  const raw = await readRequestBody(req)
  if (!raw.trim()) return {}
  const parsed = JSON.parse(raw)
  return parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : {}
}

function resolveRequestUrl(req: any): string {
  const proto = String(req.headers["x-forwarded-proto"] || "http").split(",")[0]?.trim() || "http"
  const host = String(req.headers["x-forwarded-host"] || req.headers.host || "localhost").split(",")[0]?.trim() || "localhost"
  return `${proto}://${host}${req.url || "/"}`
}

function normalizeWhatsAppUserId(raw: string): string {
  const value = String(raw || "").trim()
  const withoutPrefix = value.startsWith("whatsapp:") ? value.slice("whatsapp:".length) : value
  return withoutPrefix.replace(/\s+/g, "").replace(/^\+/, "").replace(/[^\d]/g, "")
}

function logPlannerOutcome(args: {
  source: "internal" | "twilio"
  whatsappUserId: string
  message: string
  reply: string
  metadata?: Record<string, unknown>
}): void {
  const metadata = args.metadata && typeof args.metadata === "object" ? args.metadata : {}
  console.log(JSON.stringify({
    level: "info",
    event: "whatsapp_bot_agent_planner_turn",
    source: args.source,
    whatsappUserId: args.whatsappUserId,
    messagePreview: args.message.slice(0, 120),
    replyPreview: args.reply.slice(0, 160),
    plannerAction: "plannerAction" in metadata ? metadata.plannerAction : null,
    plannerConfidence: "plannerConfidence" in metadata ? metadata.plannerConfidence : null,
    plannerQuery: "plannerQuery" in metadata ? metadata.plannerQuery : null,
    plannerCategory: "plannerCategory" in metadata ? metadata.plannerCategory : null,
    plannerQuantity: "plannerQuantity" in metadata ? metadata.plannerQuantity : null,
    plannerModifier: "plannerModifier" in metadata ? metadata.plannerModifier : null,
    plannerServings: "plannerServings" in metadata ? metadata.plannerServings : null,
    plannerSelectionIndex: "plannerSelectionIndex" in metadata ? metadata.plannerSelectionIndex : null,
    plannerLogged: "plannerAction" in metadata,
  }))
}

async function logCatalogHealth(stateFile: string): Promise<void> {
  try {
    const store = new FileStateStore(stateFile)
    const products = await store.listAlfiesProducts()
    console.log(JSON.stringify({
      level: products.length > 0 ? "info" : "warn",
      event: "whatsapp_bot_agent_catalog_health",
      stateFile,
      productCount: products.length,
      note: products.length > 0
        ? "shared Alfies catalog available"
        : "no Alfies products found in shared state; browse and recipe flows will return empty results",
    }))
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.warn(JSON.stringify({
      level: "warn",
      event: "whatsapp_bot_agent_catalog_health_failed",
      stateFile,
      message,
    }))
  }
}
