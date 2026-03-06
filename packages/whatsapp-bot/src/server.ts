import { createServer } from "node:http"
import { randomBytes } from "node:crypto"
import { resolve } from "node:path"
import type { AgentConfig } from "@valuya/agent"
import { ConciergeClient, responseText, type ConciergeAction } from "./conciergeClient.js"
import { FileStateStore, normalizeCart, normalizeRecipe } from "./stateStore.js"
import {
  isValidTwilioSignature,
  parseTwilioForm,
  sendOutboundWhatsAppMessage,
  twimlMessage,
} from "./twilio.js"
import { ValuyaPayClient } from "./valuyaPay.js"

const PORT = Number(process.env.PORT || 8788)
const HOST = process.env.HOST?.trim() || "0.0.0.0"
const STATE_FILE = process.env.WHATSAPP_STATE_FILE?.trim() || resolve(process.cwd(), ".data/whatsapp-state.json")

const TWILIO_VALIDATE_SIGNATURE = String(process.env.TWILIO_VALIDATE_SIGNATURE || "false").toLowerCase() === "true"
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN?.trim() || ""
const TWILIO_WEBHOOK_PUBLIC_URL = process.env.TWILIO_WEBHOOK_PUBLIC_URL?.trim()

const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID?.trim() || ""
const TWILIO_WHATSAPP_NUMBER = process.env.TWILIO_WHATSAPP_NUMBER?.trim() || ""

const N8N_CONCIERGE_URL = requiredEnv("N8N_CONCIERGE_URL")
const VALUYA_BASE = (process.env.VALUYA_GUARD_BASE_URL?.trim() || process.env.VALUYA_BASE?.trim() || "").replace(/\/+$/, "")
const VALUYA_TENANT_TOKEN = requiredEnv("VALUYA_TENANT_TOKEN")
const VALUYA_BACKEND_BASE_URL = requiredEnv("VALUYA_BACKEND_BASE_URL")
const VALUYA_BACKEND_TOKEN = requiredEnv("VALUYA_BACKEND_TOKEN")
const VALUYA_PRIVATE_KEY = process.env.VALUYA_PRIVATE_KEY?.trim()
const VALUYA_RPC_URL = process.env.VALUYA_RPC_URL?.trim()

const VALUYA_RESOURCE = process.env.VALUYA_RESOURCE?.trim() || "alfies.order"
const VALUYA_PLAN = process.env.VALUYA_PLAN?.trim() || "standard"

if (!VALUYA_BASE) {
  throw new Error("VALUYA_GUARD_BASE_URL_or_VALUYA_BASE_required")
}

const cfg: AgentConfig = {
  base: VALUYA_BASE,
  tenant_token: VALUYA_TENANT_TOKEN,
}

const stateStore = new FileStateStore(STATE_FILE)
const concierge = new ConciergeClient({ webhookUrl: N8N_CONCIERGE_URL })
const confirmInFlightBySubject = new Set<string>()
const valuyaPay = new ValuyaPayClient({
  cfg,
  backendBaseUrl: VALUYA_BACKEND_BASE_URL,
  backendToken: VALUYA_BACKEND_TOKEN,
  resource: VALUYA_RESOURCE,
  plan: VALUYA_PLAN,
  privateKey: VALUYA_PRIVATE_KEY,
  rpcUrl: VALUYA_RPC_URL,
})

const server = createServer(async (req: any, res: any) => {
  try {
    if (req.method === "POST" && req.url === "/twilio/whatsapp/webhook") {
      const rawBody = await readRequestBody(req)
      const parsed = parseTwilioForm(rawBody)
      const requestUrl = resolveRequestUrl(req)

      if (TWILIO_VALIDATE_SIGNATURE) {
        if (!TWILIO_AUTH_TOKEN) {
          throw new Error("TWILIO_AUTH_TOKEN_required_when_signature_validation_enabled")
        }
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

      const reply = await handleInboundMessage(parsed.from, parsed.body, parsed.messageSid)
      res.writeHead(200, { "Content-Type": "application/xml; charset=utf-8" })
      res.end(twimlMessage(reply))
      return
    }

    res.writeHead(404, { "Content-Type": "application/json" })
    res.end(JSON.stringify({ ok: false, error: "not_found" }))
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error(JSON.stringify({ level: "error", event: "webhook_error", message }))
    res.writeHead(500, { "Content-Type": "application/xml; charset=utf-8" })
    res.end(twimlMessage("Temporärer Fehler. Bitte in 10 Sekunden erneut versuchen."))
  }
})

server.listen(PORT, HOST, () => {
  console.log(
    JSON.stringify({
      level: "info",
      event: "whatsapp_bot_started",
      host: HOST,
      port: PORT,
      webhookPath: "/twilio/whatsapp/webhook",
      resource: VALUYA_RESOURCE,
      plan: VALUYA_PLAN,
      stateFile: STATE_FILE,
    }),
  )
})

async function handleInboundMessage(from: string, rawBody: string, messageSid: string): Promise<string> {
  const subjectId = normalizeSubjectId(from)
  const phoneE164 = normalizePhoneE164(from)
  const whatsappTo = normalizeWhatsAppAddress(from)
  const text = String(rawBody || "").trim()

  console.log(
    JSON.stringify({
      level: "info",
      event: "inbound_message",
      subjectId,
      messageSid,
      textPreview: text.slice(0, 120),
    }),
  )

  if (!text) {
    return "Bitte sende einen Gerichtswunsch oder: order, alt, cancel, status."
  }

  const parsed = parseAction(text)
  const existing = await stateStore.get(subjectId)

  if (parsed.action === "status") {
    if (!existing) {
      return "Kein aktiver Warenkorb. Sende zuerst ein Gericht, z.B. 'Paella'."
    }
    if (confirmInFlightBySubject.has(subjectId)) {
      return [
        `Aktive Bestellung: ${existing.orderId}`,
        "Status: Verarbeitung läuft (Zahlung/Bestellung wird ausgeführt).",
        "",
        keywordInstructions(),
      ].join("\n")
    }
    const total = typeof existing.lastCart?.total_cents === "number" ? `${existing.lastCart.total_cents / 100} EUR` : "unbekannt"
    return [
      `Aktive Bestellung: ${existing.orderId}`,
      `Letzter Warenkorb: ${total}`,
      "",
      keywordInstructions(),
    ].join("\n")
  }

  if ((parsed.action === "confirm" || parsed.action === "alt" || parsed.action === "cancel") && !existing) {
    return "Kein aktiver Auftrag. Sende zuerst ein Gericht, z.B. 'Paella'."
  }

  if (parsed.action === "recipe") {
    const orderId = createOrderId()
    const response = await concierge.call({
      action: "recipe",
      message: parsed.message,
      orderId,
      subject: { type: "whatsapp", id: phoneE164 },
    })

    await stateStore.upsert(subjectId, {
      orderId,
      lastRecipe: normalizeRecipe(response.recipe),
      lastCart: normalizeCart(response.cart),
    })

    return `${responseText(response)}\n\n${keywordInstructions()}`
  }

  if (!existing) {
    return "Kein aktiver Auftrag. Sende zuerst ein Gericht, z.B. 'Paella'."
  }

  if (parsed.action === "alt" || parsed.action === "cancel") {
    const response = await concierge.call({
      action: parsed.action,
      orderId: existing.orderId,
      cartState: existing.lastCart,
      subject: { type: "whatsapp", id: phoneE164 },
    })

    await stateStore.upsert(subjectId, {
      orderId: existing.orderId,
      lastRecipe: normalizeRecipe(response.recipe) ?? existing.lastRecipe,
      lastCart: normalizeCart(response.cart) ?? existing.lastCart,
    })

    if (parsed.action === "cancel") {
      await stateStore.delete(subjectId)
      return "Bestellung abgebrochen. Sende ein neues Gericht, wenn du neu starten willst."
    }

    return `${responseText(response)}\n\n${keywordInstructions()}`
  }

  if (confirmInFlightBySubject.has(subjectId)) {
    return "Deine Bestellung wird bereits verarbeitet. Bitte kurz warten oder 'status' senden."
  }

  confirmInFlightBySubject.add(subjectId)
  void processConfirmInBackground({
    subjectId,
    phoneE164,
    whatsappTo,
    orderId: existing.orderId,
    lastCart: existing.lastCart,
    lastRecipe: existing.lastRecipe,
  })

  return "Alles klar. Ich verarbeite deine Bestellung jetzt und melde mich gleich mit dem Ergebnis."
}

function parseAction(text: string):
  | { action: Exclude<ConciergeAction, "status">; message?: string }
  | { action: "status" } {
  const value = text.trim().toLowerCase()

  if (value.startsWith("order") || value.startsWith("confirm")) {
    return { action: "confirm" }
  }
  if (value.startsWith("alt")) {
    return { action: "alt" }
  }
  if (value.startsWith("cancel")) {
    return { action: "cancel" }
  }
  if (value.startsWith("status")) {
    return { action: "status" }
  }
  return { action: "recipe", message: text }
}

function keywordInstructions(): string {
  return [
    "Reply with:",
    "order = ✅ Bestellen",
    "alt = 🔁 Alternativen",
    "cancel = ❌ Abbrechen",
    "status = ℹ️ Status",
  ].join("\n")
}

function normalizeSubjectId(from: string): string {
  const raw = String(from || "").trim()
  if (!raw) throw new Error("twilio_from_missing")
  const withoutPrefix = raw.startsWith("whatsapp:") ? raw.slice("whatsapp:".length) : raw
  const compact = withoutPrefix.replace(/\s+/g, "").replace(/^\+/, "")
  const digits = compact.replace(/[^\d]/g, "")
  if (!digits) throw new Error("twilio_subject_id_invalid")
  return `user:whatsapp_${digits}`
}

function normalizePhoneE164(from: string): string {
  const raw = String(from || "").trim()
  const withoutPrefix = raw.startsWith("whatsapp:") ? raw.slice("whatsapp:".length) : raw
  const compact = withoutPrefix.replace(/\s+/g, "")
  if (!compact) throw new Error("twilio_phone_missing")
  return compact.startsWith("+") ? compact : `+${compact}`
}

function normalizeWhatsAppAddress(from: string): string {
  const e164 = normalizePhoneE164(from)
  return `whatsapp:${e164}`
}

function createOrderId(): string {
  const random = randomBytes(3).toString("hex")
  return `ord_${Date.now()}_${random}`
}

function resolveRequestUrl(req: any): string {
  if (TWILIO_WEBHOOK_PUBLIC_URL) return TWILIO_WEBHOOK_PUBLIC_URL

  const host = String(req.headers.host || "localhost")
  const proto = String(req.headers["x-forwarded-proto"] || "https")
  return `${proto}://${host}${req.url || "/"}`
}

function readRequestBody(req: any): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: any[] = []

    req.on("data", (chunk: any) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
    })

    req.on("end", () => {
      resolve(Buffer.concat(chunks).toString("utf8"))
    })

    req.on("error", reject)
  })
}

function requiredEnv(name: string): string {
  const v = process.env[name]?.trim()
  if (!v) throw new Error(`${name}_required`)
  return v
}

export async function sendProactiveWhatsApp(args: { to: string; body: string }): Promise<void> {
  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !TWILIO_WHATSAPP_NUMBER) {
    throw new Error("twilio_outbound_config_missing")
  }

  await sendOutboundWhatsAppMessage({
    accountSid: TWILIO_ACCOUNT_SID,
    authToken: TWILIO_AUTH_TOKEN,
    from: TWILIO_WHATSAPP_NUMBER,
    to: args.to,
    body: args.body,
  })
}

async function processConfirmInBackground(args: {
  subjectId: string
  phoneE164: string
  whatsappTo: string
  orderId: string
  lastCart?: ReturnType<typeof normalizeCart>
  lastRecipe?: ReturnType<typeof normalizeRecipe>
}): Promise<void> {
  try {
    const payment = await valuyaPay.ensurePaid({
      subjectId: args.subjectId,
      orderId: args.orderId,
      amountCents: args.lastCart?.total_cents,
      currency: args.lastCart?.currency || "EUR",
    })

    if (!payment.ok) {
      await safeSendProactiveMessage(
        args.whatsappTo,
        [
          "Automatische Agent-Zahlung ist fehlgeschlagen.",
          `Grund: ${payment.reason}`,
          "Bitte in 5-10 Sekunden erneut mit 'order' versuchen.",
        ].join("\n"),
      )
      return
    }

    const confirmed = await concierge.call({
      action: "confirm",
      orderId: args.orderId,
      cartState: args.lastCart,
      subject: { type: "whatsapp", id: args.phoneE164 },
    })

    const recipe = normalizeRecipe(confirmed.recipe) ?? args.lastRecipe
    const cart = normalizeCart(confirmed.cart) ?? args.lastCart

    await stateStore.upsert(args.subjectId, {
      orderId: args.orderId,
      lastRecipe: recipe,
      lastCart: cart,
    })

    const orderSubmit = await valuyaPay.submitOrder({
      subjectId: args.subjectId,
      orderId: args.orderId,
      cart,
      recipe,
    })

    console.log(
      JSON.stringify({
        level: "info",
        event: "order_backend_submit_success",
        subjectId: args.subjectId,
        orderId: args.orderId,
        products: orderSubmit.orderPayload.products.length,
      }),
    )

    const eta = formatEta((confirmed as any).eta)
    const etaLine = eta ? `ETA: ${eta}` : "ETA folgt in Kürze."
    const paidText = ["✓ Bezahlt.", "Bestellung wird gepackt.", etaLine].join(" ")
    const conciergeText = responseText(confirmed)
    const finalText = [
      conciergeText ? `${paidText}\n\n${conciergeText}` : paidText,
      "",
      "Bestellung wurde an Valuya Backend gesendet.",
      "E-Mail/CSV Versand an manuel@31third.com wurde ausgelöst.",
    ].join("\n")
    await safeSendProactiveMessage(args.whatsappTo, finalText)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error(
      JSON.stringify({
        level: "error",
        event: "confirm_background_error",
        subjectId: args.subjectId,
        orderId: args.orderId,
        message,
      }),
    )
    await safeSendProactiveMessage(
      args.whatsappTo,
      "Bei der Bestellverarbeitung ist ein Fehler aufgetreten. Bitte mit 'order' erneut versuchen.",
    )
  } finally {
    confirmInFlightBySubject.delete(args.subjectId)
  }
}

async function safeSendProactiveMessage(to: string, body: string): Promise<void> {
  try {
    await sendProactiveWhatsApp({ to, body })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error(
      JSON.stringify({
        level: "error",
        event: "proactive_send_failed",
        to,
        message,
      }),
    )
  }
}

function formatEta(input: unknown): string {
  if (typeof input === "string") return input.trim()
  if (!input || typeof input !== "object") return ""

  const obj = input as Record<string, unknown>
  const direct =
    String(obj.text || obj.label || obj.window || obj.eta || "").trim()
  if (direct) return direct

  const from = String(obj.from || obj.start || obj.min || "").trim()
  const to = String(obj.to || obj.end || obj.max || "").trim()
  if (from && to) return `${from}–${to}`
  return from || to
}
