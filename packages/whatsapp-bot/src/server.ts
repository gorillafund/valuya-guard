import { createServer } from "node:http"
import { randomBytes } from "node:crypto"
import { resolve } from "node:path"
import type { AgentConfig, AgentSubject } from "@valuya/agent"
import { WhatsAppChannelAccessService } from "@valuya/whatsapp-channel-access"
import { ConciergeClient, responseText, type ConciergeAction } from "./conciergeClient.js"
import { FileStateStore, normalizeCart, normalizeRecipe } from "./stateStore.js"
import { GuardWhatsAppLinkService, extractLinkToken, normalizeWhatsAppUserId } from "./channelLinking.js"
import {
  isValidTwilioSignature,
  parseTwilioForm,
  sendOutboundWhatsAppMessage,
  twimlMessage,
} from "./twilio.js"
import {
  fetchManagedAgentCapacity,
  formatCapacityAmount,
  summarizeManagedAgentCapacity,
} from "./managedAgentCapacity.js"
import { ValuyaPayClient } from "./valuyaPay.js"

const PORT = Number(process.env.PORT || 8788)
const HOST = process.env.HOST?.trim() || "0.0.0.0"
const STATE_FILE = process.env.WHATSAPP_STATE_FILE?.trim() || resolve(process.cwd(), ".data/whatsapp-state.json")

const TWILIO_VALIDATE_SIGNATURE = String(process.env.TWILIO_VALIDATE_SIGNATURE || "false").toLowerCase() === "true"
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN?.trim() || ""
const TWILIO_WEBHOOK_PUBLIC_URL = process.env.TWILIO_WEBHOOK_PUBLIC_URL?.trim()

const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID?.trim() || ""
const TWILIO_WHATSAPP_NUMBER = process.env.TWILIO_WHATSAPP_NUMBER?.trim() || ""
const REQUEST_LOG_PREVIEW_LIMIT = 120

const N8N_CONCIERGE_URL = requiredEnv("N8N_CONCIERGE_URL")
const VALUYA_BASE = (process.env.VALUYA_GUARD_BASE_URL?.trim() || process.env.VALUYA_BASE?.trim() || "").replace(/\/+$/, "")
const VALUYA_TENANT_TOKEN = requiredEnv("VALUYA_TENANT_TOKEN")
const VALUYA_BACKEND_BASE_URL = requiredEnv("VALUYA_BACKEND_BASE_URL")
const VALUYA_BACKEND_TOKEN = requiredEnv("VALUYA_BACKEND_TOKEN")
const MARKETPLACE_PRODUCT_ID = requiredPositiveInt(
  process.env.MARKETPLACE_PRODUCT_ID || process.env.VALUYA_PRODUCT_ID,
  "MARKETPLACE_PRODUCT_ID_or_VALUYA_PRODUCT_ID_required",
)
const MARKETPLACE_MERCHANT_SLUG = process.env.MARKETPLACE_MERCHANT_SLUG?.trim() || "alfies"

const VALUYA_ORDER_RESOURCE =
  process.env.VALUYA_ORDER_RESOURCE?.trim() ||
  process.env.VALUYA_RESOURCE?.trim() ||
  "alfies.order"
const VALUYA_PLAN = process.env.VALUYA_PLAN?.trim() || "standard"
const VALUYA_PAYMENT_ASSET = process.env.VALUYA_PAYMENT_ASSET?.trim() || "EURe"
const VALUYA_PAYMENT_CURRENCY = process.env.VALUYA_PAYMENT_CURRENCY?.trim() || "EUR"
const WHATSAPP_CHANNEL_APP_ID = process.env.WHATSAPP_CHANNEL_APP_ID?.trim() || "whatsapp_main"
const WHATSAPP_PAID_CHANNEL_RESOURCE = process.env.WHATSAPP_PAID_CHANNEL_RESOURCE?.trim()
const WHATSAPP_PAID_CHANNEL_PLAN = process.env.WHATSAPP_PAID_CHANNEL_PLAN?.trim() || "standard"
const WHATSAPP_PAID_CHANNEL_VISIT_URL = process.env.WHATSAPP_PAID_CHANNEL_VISIT_URL?.trim()
const WHATSAPP_PAID_CHANNEL_PROVIDER = process.env.WHATSAPP_PAID_CHANNEL_PROVIDER?.trim()
const WHATSAPP_PAID_CHANNEL_IDENTIFIER = process.env.WHATSAPP_PAID_CHANNEL_IDENTIFIER?.trim()
const WHATSAPP_PAID_CHANNEL_PHONE = process.env.WHATSAPP_PAID_CHANNEL_PHONE?.trim()

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
const guardLinking = new GuardWhatsAppLinkService({
  baseUrl: VALUYA_BASE,
  tenantToken: VALUYA_TENANT_TOKEN,
  channelAppId: WHATSAPP_CHANNEL_APP_ID,
  stateStore,
})
const paidChannelAccess = createPaidChannelAccessServiceOrNull()
const valuyaPay = new ValuyaPayClient({
  cfg,
  backendBaseUrl: VALUYA_BACKEND_BASE_URL,
  backendToken: VALUYA_BACKEND_TOKEN,
  resource: VALUYA_ORDER_RESOURCE,
  plan: VALUYA_PLAN,
  marketplaceProductId: MARKETPLACE_PRODUCT_ID,
  marketplaceMerchantSlug: MARKETPLACE_MERCHANT_SLUG,
  logger: (event, fields) => console.log(JSON.stringify({ level: "info", event, ...fields })),
})

if (VALUYA_ORDER_RESOURCE.startsWith("whatsapp:bot:")) {
  console.warn(
    JSON.stringify({
      level: "warn",
      event: "payment_resource_suspect",
      resource: VALUYA_ORDER_RESOURCE,
      plan: VALUYA_PLAN,
      note: "payment entitlement resource looks like a WhatsApp bot resource; verify the product is registered under the same tenant as VALUYA_TENANT_TOKEN",
    }),
  )
}

const server = createServer(async (req: any, res: any) => {
  const startedAt = Date.now()
  const requestPath = getRequestPath(req.url)
  try {
    if (req.method === "POST" && requestPath === "/twilio/whatsapp/webhook") {
      const rawBody = await readRequestBody(req)
      const parsed = parseTwilioForm(rawBody)
      const requestUrl = resolveRequestUrl(req)

      console.log(
        JSON.stringify({
          level: "info",
          event: "twilio_webhook_received",
          method: req.method,
          path: requestPath,
          messageSid: parsed.messageSid,
          from: parsed.from,
          bodyPreview: parsed.body.slice(0, REQUEST_LOG_PREVIEW_LIMIT),
        }),
      )

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

      const reply = await handleInboundMessage(parsed.from, parsed.body, parsed.messageSid, parsed.profileName)
      console.log(
        JSON.stringify({
          level: "info",
          event: "twilio_webhook_reply",
          messageSid: parsed.messageSid,
          duration_ms: Date.now() - startedAt,
          replyPreview: reply.slice(0, REQUEST_LOG_PREVIEW_LIMIT),
        }),
      )
      res.writeHead(200, { "Content-Type": "application/xml; charset=utf-8" })
      res.end(twimlMessage(reply))
      return
    }

    console.warn(
      JSON.stringify({
        level: "warn",
        event: "webhook_not_found",
        method: req.method,
        path: requestPath,
      }),
    )
    res.writeHead(404, { "Content-Type": "application/json" })
    res.end(JSON.stringify({ ok: false, error: "not_found" }))
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error(
      JSON.stringify({
        level: "error",
        event: "webhook_error",
        path: requestPath,
        duration_ms: Date.now() - startedAt,
        message,
      }),
    )
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
      conciergeUrl: N8N_CONCIERGE_URL,
      resource: VALUYA_ORDER_RESOURCE,
      plan: VALUYA_PLAN,
      stateFile: STATE_FILE,
    }),
  )
})

async function handleInboundMessage(
  from: string,
  rawBody: string,
  messageSid: string,
  profileName?: string,
): Promise<string> {
  const subjectId = normalizeSubjectId(from)
  const whatsappUserId = normalizeWhatsAppUserId(from)
  const phoneE164 = normalizePhoneE164(from)
  const whatsappTo = normalizeWhatsAppAddress(from)
  const text = String(rawBody || "").trim()

  console.log(
    JSON.stringify({
      level: "info",
      event: "inbound_message",
      subjectId,
      whatsappUserId,
      messageSid,
      textPreview: text.slice(0, REQUEST_LOG_PREVIEW_LIMIT),
    }),
  )

  if (!text) {
    return "Bitte sende einen Gerichtswunsch oder: order, alt, cancel, status, channel."
  }

  const linkToken = extractLinkToken(text)
  if (linkToken) {
    return handleLinkTokenMessage({
      whatsappUserId,
      linkToken,
      whatsappProfileName: profileName,
    })
  }

  const parsed = parseAction(text)
  const existing = await stateStore.get(subjectId)

  if (parsed.action === "status") {
    if (!existing) {
      return "Kein aktiver Warenkorb. Sende zuerst ein Gericht, z.B. 'Paella'."
    }
    const channelLink = await stateStore.getChannelLink(whatsappUserId)
    const capacityLines = await buildManagedCapacityLinesForWhatsApp({
      subjectHeader: channelLink?.valuya_protocol_subject_header,
    })
    if (confirmInFlightBySubject.has(subjectId)) {
      return [
        `Aktive Bestellung: ${existing.orderId}`,
        "Status: Verarbeitung läuft (Zahlung/Bestellung wird ausgeführt).",
        "",
        ...capacityLines,
        ...(capacityLines.length > 0 ? [""] : []),
        keywordInstructions(),
      ].join("\n")
    }
    const total = typeof existing.lastCart?.total_cents === "number" ? `${existing.lastCart.total_cents / 100} EUR` : "unbekannt"
    return [
      `Aktive Bestellung: ${existing.orderId}`,
      `Letzter Warenkorb: ${total}`,
      "",
      ...capacityLines,
      ...(capacityLines.length > 0 ? [""] : []),
      keywordInstructions(),
    ].join("\n")
  }

  if (parsed.action === "channel") {
    if (!paidChannelAccess) {
      return "Paid WhatsApp channel access ist fuer diesen Bot nicht konfiguriert."
    }
    try {
      const access = await paidChannelAccess.resolveAccess({
        whatsappUserId,
        whatsappProfileName: profileName,
      })
      if (!access.allowed) {
        return access.reply
      }
      if (access.channelUrl) {
        return [
          "Zugriff aktiv.",
          "Hier ist dein WhatsApp-Channel-Link:",
          access.channelUrl,
        ].join("\n")
      }
      return "Zugriff aktiv. Channel-Link-Automation ist noch nicht konfiguriert."
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.error(JSON.stringify({ level: "error", event: "whatsapp_channel_access_error", message }))
      return "Channel-Zugriff konnte gerade nicht geprueft werden. Bitte erneut versuchen."
    }
  }

  if ((parsed.action === "confirm" || parsed.action === "alt" || parsed.action === "cancel") && !existing) {
    return "Kein aktiver Auftrag. Sende zuerst ein Gericht, z.B. 'Paella'."
  }

  if (parsed.action === "recipe") {
    const orderId = createOrderId()
    console.log(
      JSON.stringify({
        level: "info",
        event: "concierge_recipe_request",
        messageSid,
        subjectId,
        orderId,
        messagePreview: String(parsed.message || "").slice(0, REQUEST_LOG_PREVIEW_LIMIT),
      }),
    )
    const response = await concierge.call({
      action: "recipe",
      message: parsed.message,
      orderId,
      subject: { type: "whatsapp", id: phoneE164 },
    })

    console.log(
      JSON.stringify({
        level: "info",
        event: "concierge_recipe_response",
        messageSid,
        subjectId,
        orderId,
        hasRecipe: Boolean(response.recipe),
        hasCart: Boolean(response.cart),
        textPreview: responseText(response).slice(0, REQUEST_LOG_PREVIEW_LIMIT),
      }),
    )

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

  const linked = await guardLinking.ensureLinkedForPaymentAction({
    whatsappUserId,
    whatsappProfileName: profileName,
  })
  if (!linked.allowed) {
    return linked.reply
  }

  confirmInFlightBySubject.add(subjectId)
  void processConfirmInBackground({
    subjectId,
    phoneE164,
    whatsappTo,
    orderId: existing.orderId,
    lastCart: existing.lastCart,
    lastRecipe: existing.lastRecipe,
    valuyaSubject: { type: linked.subject.type, id: linked.subject.externalId },
    protocolSubjectHeader: linked.subject.protocolSubjectHeader,
    guardSubjectId: linked.subject.guardSubjectId,
    guardSubjectType: linked.subject.guardSubjectType,
    guardSubjectExternalId: linked.subject.guardSubjectExternalId,
    linkedWalletAddress: linked.subject.linkedWalletAddress,
  })

  return "Alles klar. Ich verarbeite deine Bestellung jetzt und melde mich gleich mit dem Ergebnis."
}

function parseAction(text: string):
  | { action: Exclude<ConciergeAction, "status">; message?: string }
  | { action: "status" | "channel" } {
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
  if (value.startsWith("channel")) {
    return { action: "channel" }
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
    "channel = 💬 Paid Channel",
  ].join("\n")
}

function createPaidChannelAccessServiceOrNull(): WhatsAppChannelAccessService | null {
  const hasExplicit = Boolean(WHATSAPP_PAID_CHANNEL_RESOURCE)
  const hasParts = Boolean(
    WHATSAPP_PAID_CHANNEL_PROVIDER &&
      WHATSAPP_PAID_CHANNEL_IDENTIFIER &&
      WHATSAPP_PAID_CHANNEL_PHONE,
  )
  if (!hasExplicit && !hasParts) return null
  return new WhatsAppChannelAccessService({
    baseUrl: VALUYA_BASE,
    tenantToken: VALUYA_TENANT_TOKEN,
    linking: guardLinking as any,
    channelResource: WHATSAPP_PAID_CHANNEL_RESOURCE,
    channelProvider: WHATSAPP_PAID_CHANNEL_PROVIDER,
    channelIdentifier: WHATSAPP_PAID_CHANNEL_IDENTIFIER,
    channelPhoneNumber: WHATSAPP_PAID_CHANNEL_PHONE,
    channelPlan: WHATSAPP_PAID_CHANNEL_PLAN,
    channelVisitUrl: WHATSAPP_PAID_CHANNEL_VISIT_URL,
    logger: (event: string, fields: Record<string, unknown>) =>
      console.log(JSON.stringify({ level: "info", event, ...fields })),
  })
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

function getRequestPath(urlValue: string | undefined): string {
  const raw = String(urlValue || "").trim() || "/"
  try {
    const pathname = new URL(raw, "http://localhost").pathname
    if (pathname.length > 1) return pathname.replace(/\/+$/, "")
    return pathname
  } catch {
    return raw
  }
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

function requiredPositiveInt(value: string | undefined, error: string): number {
  const n = Number(value)
  if (!Number.isFinite(n)) throw new Error(error)
  const i = Math.trunc(n)
  if (i <= 0) throw new Error(error)
  return i
}

async function handleLinkTokenMessage(args: {
  whatsappUserId: string
  linkToken: string
  whatsappProfileName?: string
}): Promise<string> {
  console.log(
    JSON.stringify({
      level: "info",
      event: "link_attempt",
      whatsappUserId: args.whatsappUserId,
      tokenPrefix: args.linkToken.slice(0, 8),
    }),
  )

  const result = await guardLinking.redeemLinkToken(args)
  if (result.linked) {
    console.log(
      JSON.stringify({
        level: "info",
        event: "link_success",
        whatsappUserId: args.whatsappUserId,
        source: result.source,
        tenantId: result.link.tenant_id,
        subjectType: result.subject.type,
      }),
    )
    const capacityLines = await buildManagedCapacityLinesForWhatsApp({
      subjectHeader: result.subject.protocolSubjectHeader,
    })
    return [
      "Konto erfolgreich verknuepft.",
      ...(capacityLines.length > 0 ? ["", ...capacityLines] : []),
      "",
      "Du kannst jetzt mit 'order' fortfahren.",
    ].join("\n")
  }

  console.warn(
    JSON.stringify({
      level: "warn",
      event: "link_failure",
      whatsappUserId: args.whatsappUserId,
      code: result.code,
      reason: result.message,
    }),
  )

  return result.message
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
  valuyaSubject: AgentSubject
  protocolSubjectHeader?: string
  guardSubjectId?: string
  guardSubjectType?: string
  guardSubjectExternalId?: string
  linkedWalletAddress?: string
  lastCart?: ReturnType<typeof normalizeCart>
  lastRecipe?: ReturnType<typeof normalizeRecipe>
}): Promise<void> {
  try {
    const payment = await valuyaPay.ensurePaid({
      subject: args.valuyaSubject,
      orderId: args.orderId,
      amountCents: args.lastCart?.total_cents,
      currency: args.lastCart?.currency || "EUR",
      actorType: "agent",
      channel: "whatsapp",
      protocolSubjectHeader: args.protocolSubjectHeader,
      guardSubjectId: args.guardSubjectId,
      guardSubjectType: args.guardSubjectType,
      guardSubjectExternalId: args.guardSubjectExternalId,
      linkedWalletAddress: args.linkedWalletAddress,
      cart: args.lastCart?.items,
      recipe: args.lastRecipe,
    })

    if (!payment.ok) {
      if (payment.checkoutUrl) {
        await stateStore.upsertMarketplaceOrderLink(args.orderId, {
          valuya_order_id: payment.valuyaOrderId || args.orderId,
          checkout_url: payment.checkoutUrl,
          guard_subject_id: args.guardSubjectId,
          guard_subject_type: args.guardSubjectType,
          guard_subject_external_id: args.guardSubjectExternalId,
          protocol_subject_header: String(args.protocolSubjectHeader || ""),
          amount_cents: Math.trunc(Number(args.lastCart?.total_cents || 0)),
          currency: String(args.lastCart?.currency || "EUR"),
          status: "awaiting_checkout",
        })
        console.log(
          JSON.stringify({
            level: "info",
            event: "marketplace_checkout_link_sent",
            tenant: VALUYA_TENANT_TOKEN.slice(0, 12),
            local_order_id: args.orderId,
            returned_valuya_order_id: payment.valuyaOrderId || null,
            checkout_url: payment.checkoutUrl,
            guard_subject_id: args.guardSubjectId || null,
            guard_subject_type: args.guardSubjectType || null,
            guard_subject_external_id: args.guardSubjectExternalId || null,
            protocol_subject_header: args.protocolSubjectHeader || null,
            product_id: MARKETPLACE_PRODUCT_ID,
            merchant_slug: MARKETPLACE_MERCHANT_SLUG,
            channel: "whatsapp",
            resource: VALUYA_ORDER_RESOURCE,
            plan: VALUYA_PLAN,
            amount_cents: args.lastCart?.total_cents ?? null,
          }),
        )
      }
      await safeSendProactiveMessage(
        args.whatsappTo,
        payment.checkoutUrl
          ? [
              "Checkout erforderlich fuer diesen Bestellbetrag.",
              "Bitte ueber den Link bezahlen und danach erneut mit 'order' bestaetigen:",
              payment.checkoutUrl,
            ].join("\n")
          : payment.topupUrl
            ? [
                "Dein Wallet-Guthaben reicht fuer die automatische Agent-Zahlung aktuell nicht aus.",
                "Bitte ueber den Link Guthaben aufladen und danach erneut mit 'order' bestaetigen:",
                payment.topupUrl,
              ].join("\n")
          : payment.reason === "pending_settlement"
            ? [
                "Zahlung wurde gesendet und wird noch bestaetigt.",
                "Bitte versuche es gleich noch einmal.",
              ].join("\n")
          : [
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
      subject: args.valuyaSubject,
      orderId: args.orderId,
      cart,
      recipe,
      actorType: "agent",
      channel: "whatsapp",
    })

    console.log(
      JSON.stringify({
        level: "info",
        event: "order_backend_submit_success",
        subjectId: args.subjectId,
        orderId: args.orderId,
        flow_branch: "post_payment_order_dispatch",
        tenant: VALUYA_TENANT_TOKEN.slice(0, 12),
        protocol_subject_header: args.protocolSubjectHeader || null,
        resource: VALUYA_ORDER_RESOURCE,
        plan: VALUYA_PLAN,
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
      "E-Mail/CSV Versand wurde ausgeloest.",
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

async function buildManagedCapacityLinesForWhatsApp(args: {
  subjectHeader?: string
}): Promise<string[]> {
  const subjectHeader = String(args.subjectHeader || "").trim()
  if (!subjectHeader) return []

  try {
    const response = await fetchManagedAgentCapacity({
      baseUrl: VALUYA_BASE,
      tenantToken: VALUYA_TENANT_TOKEN,
      subjectHeader,
      resource: WHATSAPP_PAID_CHANNEL_RESOURCE || VALUYA_ORDER_RESOURCE,
      plan: WHATSAPP_PAID_CHANNEL_PLAN || VALUYA_PLAN,
      asset: VALUYA_PAYMENT_ASSET,
      currency: VALUYA_PAYMENT_CURRENCY,
      logger: (event, fields) =>
        console.log(JSON.stringify({ level: "info", event, ...fields })),
    })
    const summary = summarizeManagedAgentCapacity(response)
    return [
      "Valuya Agent:",
      `Wallet-Guthaben: ${formatCapacityAmount(summary.walletBalanceCents, summary.currency)}`,
      `Insgesamt verfuegbar: ${formatCapacityAmount(summary.overallSpendableCents, summary.currency)}`,
      `Fuer diesen WhatsApp-Bot jetzt verfuegbar: ${formatCapacityAmount(summary.botSpendableNowCents, summary.currency)}`,
    ]
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.warn(
      JSON.stringify({
        level: "warn",
        event: "managed_agent_capacity_unavailable",
        subject_header: subjectHeader,
        resource: WHATSAPP_PAID_CHANNEL_RESOURCE || VALUYA_ORDER_RESOURCE,
        plan: WHATSAPP_PAID_CHANNEL_PLAN || VALUYA_PLAN,
        message,
      }),
    )
    return []
  }
}
