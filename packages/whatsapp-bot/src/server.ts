import { createServer } from "node:http"
import { randomBytes } from "node:crypto"
import { resolve } from "node:path"
import type { AgentConfig, AgentSubject } from "@valuya/agent"
import { WhatsAppChannelAccessService } from "@valuya/whatsapp-channel-access"
import { ConciergeClient, responseText, type ConciergeAction } from "./conciergeClient.js"
import { FileStateStore, normalizeCart, normalizeRecipe, type PendingDialog, type ShoppingPreferences } from "./stateStore.js"
import { buildSessionAddress, summarizeShippingMethods } from "./alfiesAddress.js"
import { AlfiesClient } from "./alfiesClient.js"
import { explainCatalogMiss, parseResolverRules, resolveProductsFromCatalog, resolveProductsFromMessage } from "./alfiesProductResolver.js"
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
import { OpenAIIntentClient, fallbackCatalogQuery } from "./openaiIntent.js"
import { ValuyaPayClient } from "./valuyaPay.js"

const PORT = Number(process.env.PORT || 8788)
const HOST = process.env.HOST?.trim() || "0.0.0.0"
const STATE_FILE = process.env.WHATSAPP_STATE_FILE?.trim() || resolve(process.cwd(), ".data/whatsapp-state.sqlite")

const TWILIO_VALIDATE_SIGNATURE = String(process.env.TWILIO_VALIDATE_SIGNATURE || "false").toLowerCase() === "true"
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN?.trim() || ""
const TWILIO_WEBHOOK_PUBLIC_URL = process.env.TWILIO_WEBHOOK_PUBLIC_URL?.trim()

const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID?.trim() || ""
const TWILIO_WHATSAPP_NUMBER = process.env.TWILIO_WHATSAPP_NUMBER?.trim() || ""
const REQUEST_LOG_PREVIEW_LIMIT = 120
const DEFAULT_MARKETPLACE_RESOURCE = "whatsapp:bot:meta:alfies_whatsapp_marketplace:491234567890"

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
  DEFAULT_MARKETPLACE_RESOURCE
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
const OPENAI_API_KEY = process.env.OPENAI_API_KEY?.trim()
const OPENAI_MODEL = process.env.OPENAI_MODEL?.trim() || "gpt-4.1-mini"
const ALFIES_TEST_API_ENABLED = String(process.env.ALFIES_TEST_API_ENABLED || "false").toLowerCase() === "true"
const ALFIES_TEST_API_BASE_URL = process.env.ALFIES_TEST_API_BASE_URL?.trim() || "https://test-api.alfies.shop/api/v1"
const ALFIES_TEST_COUNTRY_CODE = process.env.ALFIES_TEST_COUNTRY_CODE?.trim() || "AT"
const ALFIES_TEST_DEFAULT_LATITUDE = Number(process.env.ALFIES_TEST_DEFAULT_LATITUDE || "48.2082")
const ALFIES_TEST_DEFAULT_LONGITUDE = Number(process.env.ALFIES_TEST_DEFAULT_LONGITUDE || "16.3738")
const ALFIES_TEST_SHIPPING_METHOD = process.env.ALFIES_TEST_SHIPPING_METHOD?.trim() || "standard"
const ALFIES_TEST_PRODUCT_MAP_JSON = process.env.ALFIES_TEST_PRODUCT_MAP_JSON?.trim()

if (!VALUYA_BASE) {
  throw new Error("VALUYA_GUARD_BASE_URL_or_VALUYA_BASE_required")
}

const cfg: AgentConfig = {
  base: VALUYA_BASE,
  tenant_token: VALUYA_TENANT_TOKEN,
}

const stateStore = new FileStateStore(STATE_FILE)
const intentInterpreter = OPENAI_API_KEY
  ? new OpenAIIntentClient({ apiKey: OPENAI_API_KEY, model: OPENAI_MODEL })
  : undefined
const concierge = new ConciergeClient({ intentInterpreter })
const confirmInFlightBySubject = new Set<string>()
const guardLinking = new GuardWhatsAppLinkService({
  baseUrl: VALUYA_BASE,
  tenantToken: VALUYA_TENANT_TOKEN,
  channelAppId: WHATSAPP_CHANNEL_APP_ID,
  stateStore,
})
const paidChannelAccess = createPaidChannelAccessServiceOrNull()
const alfiesResolverRules = parseResolverRules(ALFIES_TEST_PRODUCT_MAP_JSON)
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

if (VALUYA_ORDER_RESOURCE === "alfies.order") {
  console.warn(
    JSON.stringify({
      level: "warn",
      event: "payment_resource_invalid_alias",
      resource: VALUYA_ORDER_RESOURCE,
      plan: VALUYA_PLAN,
      note: "alfies.order is not the canonical product resource; configure VALUYA_ORDER_RESOURCE to the backend-registered product resource",
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
  const profile = await stateStore.getProfile(subjectId)

  const addressHint = extractAddressHint(text)
  if (addressHint) {
    let alfiesNote = "Adresse als Hint gespeichert."
    const nextProfilePatch: Record<string, unknown> = {
      deliveryAddressHint: addressHint,
      guidedMode: true,
    }
    if (ALFIES_TEST_API_ENABLED) {
      const sessionAddress = buildSessionAddress({
        addressHint,
        latitude: ALFIES_TEST_DEFAULT_LATITUDE,
        longitude: ALFIES_TEST_DEFAULT_LONGITUDE,
        shippingMethod: ALFIES_TEST_SHIPPING_METHOD,
        phone: phoneE164,
      })
      if (sessionAddress) {
        try {
          const alfies = new AlfiesClient({
            baseUrl: ALFIES_TEST_API_BASE_URL,
            countryCode: ALFIES_TEST_COUNTRY_CODE,
          })
          await alfies.setSessionAddress(sessionAddress)
          const shippingMethods = await alfies.getShippingMethods()
          const session = alfies.getSessionState()
          const shippingSummary = summarizeShippingMethods(shippingMethods)
          Object.assign(nextProfilePatch, {
            alfiesSessionId: session.sessionId,
            alfiesAddressReady: true,
            alfiesShippingSummary: shippingSummary,
          })
          alfiesNote = shippingSummary
            ? `Alfies Session aktiv. Versandoptionen: ${shippingSummary}`
            : "Alfies Session aktiv."
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          console.warn(JSON.stringify({
            level: "warn",
            event: "alfies_session_address_failed",
            subjectId,
            message,
          }))
          Object.assign(nextProfilePatch, {
            alfiesAddressReady: false,
          })
          alfiesNote = "Adresse gespeichert, aber Alfies-Session konnte noch nicht vorbereitet werden."
        }
      } else {
        alfiesNote = "Adresse gespeichert. Fuer Alfies-Session bitte Format nutzen: 'address: Strasse Hausnummer, PLZ Stadt'."
      }
    }
    await stateStore.upsertProfile(subjectId, {
      onboardingStage: existing ? "active" : "address_captured",
      profile: nextProfilePatch as any,
    })
    return [
      "Lieferadresse gespeichert.",
      addressHint,
      "",
      alfiesNote,
      "",
      existing
        ? "Du kannst jetzt mit 'order' fortfahren oder einen neuen Wunsch schicken."
        : "Sende jetzt einen Gerichtswunsch, z.B. 'vegetarian pasta for 2'.",
      "",
      keywordInstructions(),
    ].join("\n")
  }

  if (parsed.action === "help" || (!existing && isGuidedWelcomeTrigger(text))) {
    return guidedWelcomeText()
  }

  if (isPreferencesMenuTrigger(text)) {
    await stateStore.upsertProfile(subjectId, {
      onboardingStage: profile?.onboardingStage ?? "guided",
      profile: {
        guidedMode: true,
        pendingDialog: { kind: "preferences", step: "choose" },
      },
    })
    return preferencesMenuText(profile?.profile?.shoppingPreferences)
  }

  const pendingDialogResolution = resolvePendingDialogAnswer(text, profile?.profile?.pendingDialog)
  if (pendingDialogResolution?.kind === "preferences_repeat") {
    return preferencesMenuText(profile?.profile?.shoppingPreferences)
  }
  if (pendingDialogResolution?.kind === "modify_or_new") {
    await stateStore.upsertProfile(subjectId, {
      onboardingStage: profile?.onboardingStage ?? "guided",
      profile: {
        pendingDialog: undefined,
      },
    })

    if (pendingDialogResolution.selection === "modify_current_cart") {
      return existing
        ? "Alles klar. Sag mir kurz, was ich am aktuellen Warenkorb aendern soll."
        : "Es gibt noch keinen aktiven Warenkorb. Was soll ich stattdessen neu fuer dich zusammenstellen?"
    }

    if (pendingDialogResolution.selection === "start_new_cart") {
      const nextMessage = pendingDialogResolution.proposedMessage || text
      const orderId = createOrderId()
      const response = await concierge.call({
        action: "recipe",
        message: nextMessage,
        orderId,
        subject: { type: "whatsapp", id: phoneE164 },
      })
      const alfiesEnriched = await maybeBuildLiveAlfiesBasket({
        subjectId,
        phoneE164,
        message: nextMessage,
        response,
        profile,
      })
      const finalResponse = alfiesEnriched?.response || response

      await stateStore.upsert(subjectId, {
        orderId,
        lastRecipe: normalizeRecipe(finalResponse.recipe),
        lastCart: normalizeCart(finalResponse.cart),
      })
      await stateStore.upsertProfile(subjectId, {
        onboardingStage: profile?.profile?.deliveryAddressHint ? "active" : "guided",
        profile: {
          guidedMode: true,
          pendingDialog: undefined,
          ...(alfiesEnriched?.profilePatch || {}),
        },
      })

      return [
        responseText(finalResponse),
        "",
        alfiesEnriched?.note
          ? alfiesEnriched.note
          : profile?.profile?.alfiesShippingSummary
            ? `Alfies: ${profile.profile.alfiesShippingSummary}`
            : profile?.profile?.deliveryAddressHint
              ? `Lieferhinweis: ${profile.profile.deliveryAddressHint}`
              : "Optional: sende 'address: Strasse Hausnummer, PLZ Stadt' fuer die spaetere Alfies-Lieferadresse.",
        "",
        keywordInstructions(),
      ].join("\n")
    }

    if (pendingDialogResolution.selection === "clarify") {
      return [
        "Meinst du eine Aenderung am aktuellen Warenkorb oder soll ich etwas Neues fuer dich zusammenstellen?",
        "",
        "Antwort zum Beispiel mit:",
        "- aktueller warenkorb",
        "- aendern",
        "- etwas neues",
        "- neu",
      ].join("\n")
    }
  }

  const preferenceSelection = parsePreferenceSelection(text)
  if (profile?.profile?.pendingDialog?.kind === "preferences") {
    if (!preferenceSelection) {
      return [
        "Ich habe das noch nicht als Praeferenz verstanden.",
        "Welche Auswahl soll ich fuer dich bevorzugen?",
        "",
        "Antwort zum Beispiel mit:",
        "- cheapest",
        "- regional",
        "- bio",
        "- cheapest, bio",
        "- none",
      ].join("\n")
    }
    const updatedPreferences = mergeShoppingPreferences(profile?.profile?.shoppingPreferences, preferenceSelection)
    await stateStore.upsertProfile(subjectId, {
      onboardingStage: profile?.onboardingStage ?? "guided",
      profile: {
        guidedMode: true,
        shoppingPreferences: updatedPreferences,
        pendingDialog: undefined,
      },
    })
    return [
      "Praeferenzen gespeichert.",
      describePreferences(updatedPreferences),
      "",
      existing
        ? "Du kannst jetzt mit deinem aktuellen Warenkorb weitermachen oder einen neuen Wunsch schicken."
        : "Was soll ich fuer dich zusammenstellen?",
    ].join("\n")
  }

  if (preferenceSelection) {
    const updatedPreferences = mergeShoppingPreferences(profile?.profile?.shoppingPreferences, preferenceSelection)
    await stateStore.upsertProfile(subjectId, {
      onboardingStage: profile?.onboardingStage ?? "guided",
      profile: {
        guidedMode: true,
        shoppingPreferences: updatedPreferences,
      },
    })
    return [
      "Verstanden.",
      describePreferences(updatedPreferences),
      "",
      existing ? "Wenn du magst, passe ich den aktuellen Wunsch daran an." : "Was soll ich fuer dich besorgen?",
    ].join("\n")
  }

  if (parsed.action === "status") {
    if (!existing) {
      return guidedNoActiveOrderText()
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
    return guidedNoActiveOrderText()
  }

  const clarification = buildReasonableClarification(text, { hasExistingOrder: Boolean(existing) })
  if (parsed.action === "recipe" && clarification) {
    if (typeof clarification !== "string" && clarification.kind === "modify_or_new") {
      await stateStore.upsertProfile(subjectId, {
        onboardingStage: profile?.onboardingStage ?? "guided",
        profile: {
          guidedMode: true,
          pendingDialog: {
            kind: "modify_or_new",
            options: ["modify_current_cart", "start_new_cart"],
            proposedMessage: text,
          },
        },
      })
      return clarification.message
    }
    if (typeof clarification === "string") {
      return clarification
    }
  }

  if (parsed.action === "recipe" || parsed.action === "test_1cent") {
    const orderId = createOrderId()
    console.log(
      JSON.stringify({
        level: "info",
        event: "concierge_recipe_request",
        messageSid,
        subjectId,
        orderId,
        action: parsed.action,
        messagePreview: String(parsed.message || "").slice(0, REQUEST_LOG_PREVIEW_LIMIT),
      }),
    )
    const response = await concierge.call({
      action: parsed.action,
      message: parsed.message,
      orderId,
      subject: { type: "whatsapp", id: phoneE164 },
    })
    const alfiesEnriched = parsed.action === "recipe"
      ? await maybeBuildLiveAlfiesBasket({
          subjectId,
          phoneE164,
          message: parsed.message || "",
          response,
          profile,
        })
      : null
    const finalResponse = alfiesEnriched?.response || response

    console.log(
      JSON.stringify({
        level: "info",
        event: "concierge_recipe_response",
        messageSid,
        subjectId,
        orderId,
        hasRecipe: Boolean(finalResponse.recipe),
        hasCart: Boolean(finalResponse.cart),
        textPreview: responseText(finalResponse).slice(0, REQUEST_LOG_PREVIEW_LIMIT),
      }),
    )

    await stateStore.upsert(subjectId, {
      orderId,
      lastRecipe: normalizeRecipe(finalResponse.recipe),
      lastCart: normalizeCart(finalResponse.cart),
    })
    await stateStore.upsertProfile(subjectId, {
      onboardingStage: profile?.profile?.deliveryAddressHint ? "active" : "guided",
      profile: {
        guidedMode: true,
        ...(alfiesEnriched?.profilePatch || {}),
      },
    })

    return [
      responseText(finalResponse),
      "",
      profile?.profile?.shoppingPreferences
        ? describePreferences(profile.profile.shoppingPreferences)
        : null,
      profile?.profile?.shoppingPreferences ? "" : null,
      alfiesEnriched?.note
        ? alfiesEnriched.note
        : profile?.profile?.alfiesShippingSummary
          ? `Alfies: ${profile.profile.alfiesShippingSummary}`
        : profile?.profile?.deliveryAddressHint
          ? `Lieferhinweis: ${profile.profile.deliveryAddressHint}`
        : "Optional: sende 'address: Strasse Hausnummer, PLZ Stadt' fuer die spaetere Alfies-Lieferadresse.",
      "",
      keywordInstructions(),
    ].filter(Boolean).join("\n")
  }

  if (!existing) {
    return guidedNoActiveOrderText()
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
  | { action: "status" | "channel" | "help" } {
  const value = text.trim().toLowerCase()

  if (value === "/1cent" || value === "1cent" || value === "/test1cent" || value === "test1cent") {
    return { action: "test_1cent" }
  }
  if (value === "/start" || value === "start" || value === "/help" || value === "help") {
    return { action: "help" }
  }
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
    "Naechste Schritte:",
    "order = ✅ Bestellen",
    "alt = 🔁 Alternativen",
    "cancel = ❌ Abbrechen",
    "status = ℹ️ Status",
    "preferences = ⚙️ Praeferenzen",
    "channel = 💬 Paid Channel",
    "1cent = 🧪 1-Cent-Test",
    "help = 👋 Concierge-Erklaerung",
  ].join("\n")
}

function guidedWelcomeText(): string {
  return [
    "Alfies Concierge auf WhatsApp.",
    "",
    "Ich helfe dir, aus einem Gerichtswunsch oder Anlass einen Warenkorb zu bauen.",
    "Danach kannst du Alternativen anfordern, bezahlen und den Status pruefen.",
    "Auf Wunsch beachte ich auch Praeferenzen wie cheapest, regional oder bio.",
    "",
    "So startest du:",
    "- Sende ein Gericht: 'vegetarian pasta for 2'",
    "- Oder einen Anlass: 'snacks for movie night'",
    "- Optional zuerst Adresse: 'address: Kaiserstrasse 8/7a, 1070 Wien'",
    "- Fuer Einkaufs-Praeferenzen: 'preferences'",
    "- Oder zum Testen: '1cent'",
    "",
    keywordInstructions(),
  ].join("\n")
}

function guidedNoActiveOrderText(): string {
  return [
    "Es gibt noch keinen aktiven Warenkorb.",
    "",
    "Sende zuerst einen Wunsch, zum Beispiel:",
    "- 'Paella fuer 2'",
    "- 'vegetarian pasta for 3'",
    "- 'snacks for movie night'",
    "- 'address: Kaiserstrasse 8/7a, 1070 Wien'",
    "- 'preferences'",
    "",
    "Zum Einstieg:",
    "help = Concierge-Erklaerung",
    "1cent = Testbestellung",
  ].join("\n")
}

function isGuidedWelcomeTrigger(text: string): boolean {
  const value = text.trim().toLowerCase()
  return value === "hi" || value === "hello" || value === "hallo" || value === "hey"
}

function isPreferencesMenuTrigger(text: string): boolean {
  const value = text.trim().toLowerCase()
  return value === "preferences" || value === "preference" || value === "settings" || value === "prefs"
}

function preferencesMenuText(preferences?: ShoppingPreferences): string {
  return [
    "Welche Produktauswahl soll ich bevorzugen?",
    "",
    "- cheapest = moeglichst guenstig",
    "- regional = eher regional",
    "- bio = bevorzugt bio",
    "- none = keine besondere Vorgabe",
    "",
    preferences ? `Aktuell: ${describePreferences(preferences)}` : "Aktuell: keine gespeicherten Praeferenzen.",
    "",
    "Du kannst auch mehrere nennen, z.B. 'regional, bio'.",
  ].join("\n")
}

function parsePreferenceSelection(text: string): Partial<ShoppingPreferences> | null {
  const normalized = text.trim().toLowerCase()
  if (!normalized) return null
  if (normalized === "none" || normalized === "reset preferences" || normalized === "clear preferences") {
    return { cheapest: false, regional: false, bio: false }
  }
  const selection: Partial<ShoppingPreferences> = {}
  if (/\bcheap(est)?\b|\bgünstig\b|\bguenstig\b|\bbudget\b/.test(normalized)) selection.cheapest = true
  if (/\bregional\b|\blocal\b|\blokal\b/.test(normalized)) selection.regional = true
  if (/\bbio\b|\borganic\b/.test(normalized)) selection.bio = true
  if (!Object.keys(selection).length) return null
  return selection
}

function mergeShoppingPreferences(
  current: ShoppingPreferences | undefined,
  patch: Partial<ShoppingPreferences>,
): ShoppingPreferences {
  const merged = {
    cheapest: patch.cheapest ?? current?.cheapest ?? false,
    regional: patch.regional ?? current?.regional ?? false,
    bio: patch.bio ?? current?.bio ?? false,
  }
  return merged
}

function describePreferences(preferences: ShoppingPreferences): string {
  const active = [
    preferences.cheapest ? "cheapest" : null,
    preferences.regional ? "regional" : null,
    preferences.bio ? "bio" : null,
  ].filter(Boolean)
  return active.length
    ? `Gespeicherte Praeferenzen: ${active.join(", ")}.`
    : "Gespeicherte Praeferenzen: keine besondere Vorgabe."
}

function buildReasonableClarification(
  text: string,
  args: { hasExistingOrder: boolean },
): string | { kind: "modify_or_new"; message: string } | null {
  const value = text.trim().toLowerCase()
  if (!value) return "Was soll ich fuer dich bei Alfies zusammenstellen?"
  if (["yes", "ja", "ok", "okay", "passt"].includes(value)) {
    return args.hasExistingOrder
      ? "Soll ich den aktuellen Warenkorb bestellen, Alternativen suchen oder etwas daran aendern?"
      : "Was soll ich fuer dich zusammenstellen? Zum Beispiel: 'vegetarian pasta for 2' oder 'snacks for movie night'."
  }
  if (["no", "nein"].includes(value)) {
    return args.hasExistingOrder
      ? "Alles klar. Soll ich eine Alternative suchen oder den Warenkorb abbrechen?"
      : "Kein Problem. Was soll ich stattdessen fuer dich zusammenstellen?"
  }
  if (value.includes("?") && !looksLikeShoppingRequest(value)) {
    return [
      "Ich helfe dir beim Zusammenstellen eines Alfies-Warenkorbs.",
      "Sag mir am besten direkt, was du brauchst, zum Beispiel 'drinks for 3' oder 'vegetarian pasta for 2'.",
    ].join("\n")
  }
  if (!looksLikeShoppingRequest(value)) {
    return args.hasExistingOrder
      ? "Meinst du eine Aenderung am aktuellen Warenkorb oder soll ich etwas Neues fuer dich zusammenstellen?"
      : "Ich habe noch nicht erkannt, was ich fuer dich einkaufen soll. Was brauchst du heute?"
  }
  return null
}

function looksLikeShoppingRequest(text: string): boolean {
  return /\b(pasta|paella|snack|snacks|drink|drinks|getranke|getränke|bier|beer|breakfast|brunch|vegetarian|vegan|bio|regional|cola|water|juice|chips|pizza|bread|brot|milk|milch|eggs|eier|party|personen)\b/.test(text)
    || /\bfor\s+\d\b|\bfuer\s+\d\b|\bmit\s+\d+\s+personen\b|\b\d+x\b/.test(text)
}

function resolvePendingDialogAnswer(
  text: string,
  pendingDialog: PendingDialog,
):
  | { kind: "preferences_repeat" }
  | { kind: "modify_or_new"; selection: "modify_current_cart" | "start_new_cart" | "clarify"; proposedMessage?: string }
  | null {
  if (!pendingDialog) return null
  const value = text.trim().toLowerCase()
  if (pendingDialog.kind === "preferences") {
    return isPreferencesMenuTrigger(value) ? { kind: "preferences_repeat" } : null
  }
  if (pendingDialog.kind !== "modify_or_new") return null

  if (isNewCartAnswer(value)) {
    return {
      kind: "modify_or_new",
      selection: "start_new_cart",
      proposedMessage: pendingDialog.proposedMessage,
    }
  }
  if (isModifyCurrentCartAnswer(value)) {
    return {
      kind: "modify_or_new",
      selection: "modify_current_cart",
      proposedMessage: pendingDialog.proposedMessage,
    }
  }
  if (isGenericYes(value) || isGenericNo(value) || isOrdinalAnswer(value)) {
    return {
      kind: "modify_or_new",
      selection: inferSelectionFromShortAnswer(value),
      proposedMessage: pendingDialog.proposedMessage,
    }
  }
  return null
}

function isGenericYes(value: string): boolean {
  return ["ja", "yes", "ok", "okay", "bitte", "gerne", "passt"].includes(value)
}

function isGenericNo(value: string): boolean {
  return ["nein", "no", "nicht", "doch nicht"].includes(value)
}

function isOrdinalAnswer(value: string): boolean {
  return ["1", "1.", "erste", "das erste", "2", "2.", "zweite", "das zweite"].includes(value)
}

function inferSelectionFromShortAnswer(value: string): "modify_current_cart" | "start_new_cart" | "clarify" {
  if (["2", "2.", "zweite", "das zweite"].includes(value)) return "start_new_cart"
  if (["1", "1.", "erste", "das erste"].includes(value)) return "modify_current_cart"
  if (isGenericYes(value)) return "clarify"
  if (isGenericNo(value)) return "clarify"
  return "clarify"
}

function isNewCartAnswer(value: string): boolean {
  return /\b(neu|neue|neuen|neuer|neues|neuer warenkorb|neuen warenkorb|etwas neues|stelle etwas neues zusammen|neu starten|von vorn)\b/.test(value)
}

function isModifyCurrentCartAnswer(value: string): boolean {
  return /\b(aendern|ändern|aktuell|aktuellen warenkorb|bestehenden warenkorb|anpassen|modifizieren)\b/.test(value)
}

function extractAddressHint(text: string): string | null {
  const trimmed = text.trim()
  const match =
    /^(?:address|adresse|lieferadresse|deliver to)\s*:\s*(.+)$/i.exec(trimmed) ||
    /^(?:address|adresse|lieferadresse|deliver to)\s+(.+)$/i.exec(trimmed)
  if (!match?.[1]) return null
  const value = match[1].trim()
  return value ? value : null
}

async function maybeBuildLiveAlfiesBasket(args: {
  subjectId: string
  phoneE164: string
  message: string
  response: Awaited<ReturnType<ConciergeClient["call"]>>
  profile: Awaited<ReturnType<FileStateStore["getProfile"]>>
}): Promise<{
  response: Awaited<ReturnType<ConciergeClient["call"]>>
  note: string
  profilePatch?: Record<string, unknown>
} | null> {
  if (!ALFIES_TEST_API_ENABLED) return null
  const indexedCatalog = await stateStore.listAlfiesProducts()
  const interpretedQuery = args.message.trim()
    ? intentInterpreter
      ? await intentInterpreter.interpretCatalogQuery({
          message: args.message,
          contextSummary: [
            args.profile?.profile?.shoppingPreferences
              ? `preferences=${describePreferences(args.profile.profile.shoppingPreferences)}`
              : "",
            "alfies indexed catalog search",
          ].filter(Boolean).join("; "),
        }).catch(() => fallbackCatalogQuery(args.message))
      : fallbackCatalogQuery(args.message)
    : undefined
  const resolvedFromCatalog = resolveProductsFromCatalog(
    args.message,
    indexedCatalog,
    args.profile?.profile?.shoppingPreferences,
    interpretedQuery,
  )
  const resolved = resolvedFromCatalog || resolveProductsFromMessage(args.message, alfiesResolverRules)
  if (!resolved) {
    return {
      response: args.response,
      note: indexedCatalog.length > 0
        ? explainCatalogMiss(args.message, indexedCatalog, interpretedQuery)
        : "Alfies-Session ist bereit, aber fuer diese Anfrage gibt es noch keine konfigurierte Produktzuordnung im Bot.",
    }
  }

  const matchedProducts = matchIndexedProductsById(indexedCatalog, resolved.lines)
  const sessionId = args.profile?.profile?.alfiesSessionId
  if (!sessionId) {
    if (matchedProducts.length > 0) {
      const cart = buildIndexedSuggestionCart(matchedProducts, resolved.lines)
      return {
        response: {
          ...args.response,
          recipe: { title: buildIndexedSuggestionTitle(args.message, matchedProducts) },
          cart,
          text: [
            buildIndexedSuggestionTitle(args.message, matchedProducts),
            "",
            "Ich habe passende Produkte im Alfies-Katalog gefunden.",
            ...formatIndexedSuggestionLines(matchedProducts, resolved.lines),
            "",
            `Zwischensumme: ${formatMoney(cart.total_cents, cart.currency)}`,
          ].join("\n"),
        },
        note: [
          `Katalogtreffer gefunden${resolved.label ? ` (${resolved.label})` : ""}.`,
          "Fuer einen echten Alfies-Warenkorb brauche ich noch deine Lieferadresse.",
          "Sende: 'address: Strasse Hausnummer, PLZ Stadt'.",
        ].join("\n"),
      }
    }
    return {
      response: args.response,
      note: "Live-Alfies ist aktiviert, aber es fehlt noch eine vorbereitete Adresse. Sende zuerst 'address: Strasse Hausnummer, PLZ Stadt'.",
    }
  }

  try {
    const alfies = new AlfiesClient({
      baseUrl: ALFIES_TEST_API_BASE_URL,
      countryCode: ALFIES_TEST_COUNTRY_CODE,
      sessionId,
    })
    await alfies.clearBasket()
    for (const line of resolved.lines) {
      await alfies.addBasketProduct({
        id: line.id,
        quantity: line.quantity,
      })
    }
    const basket = await alfies.getBasket()
    const cart = mapAlfiesBasketToCart(basket)
    const shippingMethods = await alfies.getShippingMethods()
    const shippingSummary = summarizeShippingMethods(shippingMethods)
    return {
      response: {
        ...args.response,
        cart,
        text: [
          String(args.response.recipe?.title || "Alfies Basket"),
          "",
          "Live-Alfies Warenkorb erstellt.",
          ...formatAlfiesBasketLines(cart),
          "",
          `Zwischensumme: ${formatMoney(cart.total_cents, cart.currency)}`,
          ...(shippingSummary ? [`Versandoptionen: ${shippingSummary}`] : []),
        ].join("\n"),
      },
      note: `Alfies Basket aktiv${resolved.label ? ` (${resolved.label})` : ""}.`,
      profilePatch: {
        alfiesSessionId: alfies.getSessionState().sessionId || sessionId,
        alfiesAddressReady: true,
        ...(shippingSummary ? { alfiesShippingSummary: shippingSummary } : {}),
      },
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.warn(JSON.stringify({
      level: "warn",
      event: "alfies_live_basket_failed",
      subjectId: args.subjectId,
      message,
    }))
    return {
      response: args.response,
      note: "Alfies-Session ist vorbereitet, aber der Live-Warenkorb konnte gerade nicht erstellt werden. Ich nutze den lokalen Demo-Warenkorb als Fallback.",
    }
  }
}

function matchIndexedProductsById(
  products: Awaited<ReturnType<FileStateStore["listAlfiesProducts"]>>,
  lines: Array<{ id: number; quantity: number }>,
): Array<{ product: Awaited<ReturnType<FileStateStore["listAlfiesProducts"]>>[number]; quantity: number }> {
  const byId = new Map(products.map((product) => [product.product_id, product]))
  return lines
    .map((line) => {
      const product = byId.get(line.id)
      return product ? { product, quantity: line.quantity } : null
    })
    .filter((entry): entry is { product: Awaited<ReturnType<FileStateStore["listAlfiesProducts"]>>[number]; quantity: number } => Boolean(entry))
}

function buildIndexedSuggestionCart(
  matchedProducts: Array<{ product: Awaited<ReturnType<FileStateStore["listAlfiesProducts"]>>[number]; quantity: number }>,
  lines: Array<{ id: number; quantity: number }>,
): { items: unknown[]; total_cents: number; currency: string } {
  const items = matchedProducts.map(({ product, quantity }) => ({
    sku: product.slug || String(product.product_id),
    name: product.title,
    qty: quantity,
    unit_price_cents: product.price_cents || 0,
  }))
  return {
    items,
    total_cents: items.reduce(
      (sum, item) => sum + Math.trunc(Number((item as { qty: number }).qty || 0)) * Math.trunc(Number((item as { unit_price_cents: number }).unit_price_cents || 0)),
      0,
    ),
    currency: matchedProducts[0]?.product.currency || "EUR",
  }
}

function formatIndexedSuggestionLines(
  matchedProducts: Array<{ product: Awaited<ReturnType<FileStateStore["listAlfiesProducts"]>>[number]; quantity: number }>,
  lines: Array<{ id: number; quantity: number }>,
): string[] {
  return matchedProducts.map(({ product, quantity }) =>
    `- ${quantity}x ${product.title} (${formatMoney((product.price_cents || 0) * quantity, product.currency || "EUR")})`,
  )
}

function buildIndexedSuggestionTitle(
  message: string,
  matchedProducts: Array<{ product: Awaited<ReturnType<FileStateStore["listAlfiesProducts"]>>[number]; quantity: number }>,
): string {
  const firstCategory = matchedProducts[0]?.product.category
  return firstCategory
    ? `Alfies Vorschlag: ${firstCategory}`
    : `Alfies Vorschlag fuer '${message.trim()}'`
}

function mapAlfiesBasketToCart(input: unknown): { items: unknown[]; total_cents: number; currency: string } {
  const basket = input && typeof input === "object" ? (input as Record<string, unknown>) : {}
  const lines = Array.isArray(basket.lines) ? basket.lines : []
  const items = lines
    .filter((line): line is Record<string, unknown> => Boolean(line) && typeof line === "object")
    .map((line) => ({
      sku: String(line.product || line.id || "alfies-item"),
      name: String(line.productTitle || line.name || "Alfies Product"),
      qty: Number.isFinite(Number(line.quantity)) ? Math.trunc(Number(line.quantity)) : 1,
      unit_price_cents: Number.isFinite(Number(line.priceInclTax))
        ? Math.round(Number(line.priceInclTax) * 100)
        : undefined,
    }))
  const total = Number.isFinite(Number(basket.totalInclTax))
    ? Math.round(Number(basket.totalInclTax) * 100)
    : items.reduce((sum, item) => sum + Math.trunc(Number(item.qty || 0)) * Math.trunc(Number(item.unit_price_cents || 0)), 0)
  return {
    items,
    total_cents: total,
    currency: String(basket.currency || "EUR"),
  }
}

function formatAlfiesBasketLines(cart: { items: unknown[]; total_cents: number; currency: string }): string[] {
  return cart.items
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
    .map((item) => {
      const qty = Math.trunc(Number(item.qty || 1))
      const name = String(item.name || "Product")
      const unit = Number.isFinite(Number(item.unit_price_cents))
        ? Math.trunc(Number(item.unit_price_cents))
        : 0
      return `- ${qty}x ${name} (${formatMoney(qty * unit, cart.currency)})`
    })
}

function formatMoney(cents: number, currency: string): string {
  return `${(cents / 100).toFixed(2)} ${currency}`
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
    console.log(
      JSON.stringify({
        level: "info",
        event: "payment_trace",
        trace_kind: "payment_correlation",
        stage: "confirm_background_start",
        local_order_id: args.orderId,
        valuya_order_id: null,
        protocol_subject_header: args.protocolSubjectHeader || null,
        resource: VALUYA_ORDER_RESOURCE,
        plan: VALUYA_PLAN,
        amount_cents: args.lastCart?.total_cents ?? null,
        currency: args.lastCart?.currency || "EUR",
        guard_subject_id: args.guardSubjectId || null,
        guard_subject_type: args.guardSubjectType || null,
        guard_subject_external_id: args.guardSubjectExternalId || null,
      }),
    )

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

    console.log(
      JSON.stringify({
        level: "info",
        event: "payment_trace",
        trace_kind: "payment_correlation",
        stage: "ensure_paid_result",
        local_order_id: args.orderId,
        valuya_order_id: payment.valuyaOrderId || null,
        protocol_subject_header: args.protocolSubjectHeader || null,
        resource: VALUYA_ORDER_RESOURCE,
        plan: VALUYA_PLAN,
        amount_cents: args.lastCart?.total_cents ?? null,
        currency: args.lastCart?.currency || "EUR",
        guard_subject_id: args.guardSubjectId || null,
        guard_subject_type: args.guardSubjectType || null,
        guard_subject_external_id: args.guardSubjectExternalId || null,
        payment_ok: payment.ok,
        payment_reason: payment.ok ? null : payment.reason,
        checkout_url: payment.ok ? null : payment.checkoutUrl || null,
        topup_url: payment.ok ? null : payment.topupUrl || null,
      }),
    )

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
          : payment.reason === "product_not_registered"
            ? [
                "Die Zahlung wurde nicht dem erwarteten Produkt zugeordnet.",
                "Der Bot verwendet vermutlich einen falschen Resource-String.",
                `Aktuell konfiguriert: ${VALUYA_ORDER_RESOURCE}`,
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
        event: "payment_trace",
        trace_kind: "payment_correlation",
        stage: "order_backend_submit_success",
        local_order_id: args.orderId,
        valuya_order_id: payment.valuyaOrderId || null,
        protocol_subject_header: args.protocolSubjectHeader || null,
        resource: VALUYA_ORDER_RESOURCE,
        plan: VALUYA_PLAN,
        amount_cents: cart?.total_cents ?? args.lastCart?.total_cents ?? null,
        currency: cart?.currency || args.lastCart?.currency || "EUR",
        guard_subject_id: args.guardSubjectId || null,
        guard_subject_type: args.guardSubjectType || null,
        guard_subject_external_id: args.guardSubjectExternalId || null,
      }),
    )

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
