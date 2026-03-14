import { createServer } from "node:http"
import { randomBytes } from "node:crypto"
import { resolve } from "node:path"
import type { AgentConfig, AgentSubject } from "@valuya/agent"
import { WhatsAppChannelAccessService } from "@valuya/whatsapp-channel-access"
import { ConciergeClient, responseText, type ConciergeAction } from "./conciergeClient.js"
import { FileStateStore, normalizeCart, normalizeRecipe, type ConversationProfile, type PendingDialog, type PendingOption, type ShoppingPreferences } from "./stateStore.js"
import { ConversationStateService } from "./conversationStateService.js"
import { buildSessionAddress, summarizeShippingMethods } from "./alfiesAddress.js"
import { AlfiesClient } from "./alfiesClient.js"
import { explainCatalogMiss, findAlternativesForCartItems, parseResolverRules, resolveProductsFromCatalog, resolveProductsFromMessage } from "./alfiesProductResolver.js"
import { CartEditService } from "./cartEditService.js"
import { applyCartMutation, applyResolvedCartMutation } from "./cartMutationService.js"
import {
  buildCartItemActionOptions,
  buildCartItemSelectionOptions,
  buildMatchingCategoryOptions,
  buildCategorySelectionOptions,
  buildOccasionSelectionOptions,
  buildProductsForCategoryOptions,
  buildProductSelectionOptions,
  buildReferenceSelectionOptions,
  extractInlineChoiceOptions,
  formatPendingOptionsMessage,
  resolvePendingOptionSelection,
} from "./optionSelectionService.js"
import { buildActiveProductContextReply } from "./productContextService.js"
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
import { looksLikeRecipeRequest, resolveRecipeRequest } from "./recipeService.js"
import { IntentExtractionService } from "./intentExtractionService.js"
import { ReferenceResolutionService } from "./referenceResolutionService.js"
import { ShoppingRouter } from "./shoppingRouter.js"
import { UnderstandingAnalyticsService } from "./understandingAnalyticsService.js"
import { ValuyaPayClient } from "./valuyaPay.js"
import { applyResponsePlan, planResponse } from "./responsePlanner.js"
import { ContextGovernanceService } from "./contextGovernanceService.js"
import { CatalogService } from "./catalogService.js"
import { AgentConversationService } from "./agentConversationService.js"

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
const ALFIES_BACKEND_API_KEY = process.env.ALFIES_BACKEND_API_KEY?.trim() || ""
const ALFIES_TEST_API_ENABLED = String(process.env.ALFIES_TEST_API_ENABLED || "false").toLowerCase() === "true"
const ALFIES_TEST_API_BASE_URL = process.env.ALFIES_TEST_API_BASE_URL?.trim() || "https://test-api.alfies.shop/api/v1"
const ALFIES_TEST_COUNTRY_CODE = process.env.ALFIES_TEST_COUNTRY_CODE?.trim() || "AT"
const ALFIES_TEST_DEFAULT_LATITUDE = Number(process.env.ALFIES_TEST_DEFAULT_LATITUDE || "48.2082")
const ALFIES_TEST_DEFAULT_LONGITUDE = Number(process.env.ALFIES_TEST_DEFAULT_LONGITUDE || "16.3738")
const ALFIES_TEST_SHIPPING_METHOD = process.env.ALFIES_TEST_SHIPPING_METHOD?.trim() || "standard"
const ALFIES_TEST_PRODUCT_MAP_JSON = process.env.ALFIES_TEST_PRODUCT_MAP_JSON?.trim()
const WHATSAPP_AGENT_MODE = (process.env.WHATSAPP_AGENT_MODE?.trim().toLowerCase() || "off") as "off" | "shadow" | "primary"
const WHATSAPP_AGENT_BASE_URL = process.env.WHATSAPP_AGENT_BASE_URL?.trim()?.replace(/\/+$/, "")
const WHATSAPP_AGENT_INTERNAL_API_TOKEN = process.env.WHATSAPP_AGENT_INTERNAL_API_TOKEN?.trim() || ""
const WHATSAPP_AGENT_ROLLOUT_PERCENT = clampRolloutPercent(process.env.WHATSAPP_AGENT_ROLLOUT_PERCENT)

if (!VALUYA_BASE) {
  throw new Error("VALUYA_GUARD_BASE_URL_or_VALUYA_BASE_required")
}

const cfg: AgentConfig = {
  base: VALUYA_BASE,
  tenant_token: VALUYA_TENANT_TOKEN,
}

const stateStore = new FileStateStore(STATE_FILE)
const conversationState = new ConversationStateService(stateStore)
const understandingAnalytics = new UnderstandingAnalyticsService(stateStore)
const catalogService = new CatalogService(stateStore)
const intentInterpreter = OPENAI_API_KEY
  ? new OpenAIIntentClient({ apiKey: OPENAI_API_KEY, model: OPENAI_MODEL })
  : undefined
const semanticIntentExtractor = new IntentExtractionService({ apiKey: OPENAI_API_KEY, model: OPENAI_MODEL })
const referenceResolutionService = new ReferenceResolutionService()
const shoppingRouter = new ShoppingRouter()
const contextGovernanceService = new ContextGovernanceService()
const agentConversationService = new AgentConversationService({
  apiKey: OPENAI_API_KEY,
  model: OPENAI_MODEL,
  catalogService,
})
const cartEditService = new CartEditService()
const concierge = new ConciergeClient({ intentInterpreter })
const confirmInFlightBySubject = new Set<string>()
const recentRepliesByMessageSid = new Map<string, string>()
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
    if (req.method === "POST" && requestPath.startsWith("/agent-tools/")) {
      if (!isValidAgentToolAuth(req)) {
        writeJson(res, 401, { ok: false, error: "unauthorized" })
        return
      }
      const body = await parseJsonRequestBody(req)
      const result = await dispatchAgentToolRequest(requestPath.replace("/agent-tools/", ""), body)
      writeJson(res, 200, result)
      return
    }

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

      if (parsed.messageSid) {
        const cachedReply = recentRepliesByMessageSid.get(parsed.messageSid)
        if (cachedReply) {
          console.log(
            JSON.stringify({
              level: "info",
              event: "twilio_webhook_duplicate_message",
              messageSid: parsed.messageSid,
              path: requestPath,
            }),
          )
          res.writeHead(200, { "Content-Type": "application/xml; charset=utf-8" })
          res.end(twimlMessage(cachedReply))
          return
        }
      }

      const reply = await handleInboundMessage(parsed.from, parsed.body, parsed.messageSid, parsed.profileName)
      if (parsed.messageSid) {
        rememberReplyForMessageSid(parsed.messageSid, reply)
      }
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

  const forwardedAgentReply = await maybeHandleWithAgentBot({
    whatsappUserId,
    body: text,
    profileName,
    mode: WHATSAPP_AGENT_MODE,
  })
  if (forwardedAgentReply.kind === "primary") {
    return forwardedAgentReply.reply
  }

  await conversationState.recordInboundMessage(subjectId, text)

  const linkToken = extractLinkToken(text)
  if (linkToken) {
    return handleLinkTokenMessage({
      whatsappUserId,
      linkToken,
      whatsappProfileName: profileName,
    })
  }

  const parsed = parseAction(text)
  const parsedMessage = parsed.action === "recipe" ? parsed.message : undefined
  const existing = await stateStore.get(subjectId)
  const profile = await stateStore.getProfile(subjectId)
  const isRecipeIntentMessage = parsed.action === "recipe" && (looksLikeRecipeRequest(text) || isRecipeCookingIntent(text))
  const snapshot = {
    subjectId,
    onboardingStage: profile?.onboardingStage,
    conversation: existing,
    profile: profile?.profile,
  }

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
        : "Sende jetzt einen Wunsch, z.B. 'vegetarian pasta for 2', 'Milch', 'snacks for movie night' oder 'Getraenke fuer 6'.",
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
    return buildStatusReply({
      subjectId,
      whatsappUserId,
      existing,
    })
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

  if (parsed.action === "recipe" && shouldResetInteractiveState(text)) {
    await conversationState.clearActiveProduct(subjectId)
    await conversationState.clearPendingOptions(subjectId)
  }

  if (parsed.action === "recipe" && existing && isCartShowOrEditTrigger(text)) {
    const options = buildCartItemSelectionOptions(existing.lastCart)
    if (options.length === 0) {
      return guidedNoActiveOrderText()
    }
    await conversationState.setPendingOptions(subjectId, {
      kind: "cart_item_selection",
      prompt: "Welchen Artikel im Warenkorb moechtest du bearbeiten?",
      options,
    })
    return [
      formatCartOverview(existing.lastCart),
      "",
      formatPendingOptionsMessage("Welchen Artikel im Warenkorb moechtest du bearbeiten?", options),
    ].join("\n")
  }

  if (isRecipeIntentMessage) {
    await conversationState.clearActiveProduct(subjectId)
    await conversationState.clearPendingOptions(subjectId)
    if (profile?.profile?.pendingDialog?.kind === "modify_or_new") {
      await stateStore.upsertProfile(subjectId, {
        onboardingStage: profile?.onboardingStage ?? "guided",
        profile: {
          pendingDialog: undefined,
        },
      })
    }
  }

  if (parsed.action === "recipe") {
    const indexedCatalog = await stateStore.listAlfiesProducts()
    const contextReply = buildActiveProductContextReply({
      message: text,
      snapshot,
      catalog: indexedCatalog,
    })
    if (contextReply) {
      if (contextReply.nextQuestion) {
        await conversationState.setActiveProduct(subjectId, {
          product: snapshot.profile?.activeProductCandidate,
          question: contextReply.nextQuestion,
          editMode: snapshot.profile?.activeEditMode,
        })
      }
      return contextReply.text
    }
  }

  if (parsed.action === "recipe" && profile?.profile?.pendingOptions?.options?.length && isMoreOptionsRequest(text)) {
    const pending = profile.profile.pendingOptions
    const indexedCatalog = await stateStore.listAlfiesProducts()
    const nextOffset = (pending.offset || 0) + pending.options.length
    let nextOptions: typeof pending.options = []
    if (pending.kind === "category_selection" && pending.sourceQuery) {
      nextOptions = buildMatchingCategoryOptions({
        query: pending.sourceQuery,
        products: indexedCatalog,
        offset: nextOffset,
        limit: pending.options.length,
      })
    } else if (pending.kind === "product_selection" && pending.sourceCategory) {
      nextOptions = buildProductsForCategoryOptions({
        category: pending.sourceCategory,
        products: indexedCatalog,
        offset: nextOffset,
        limit: pending.options.length,
      })
    } else if (pending.kind === "product_selection" && pending.sourceQuery) {
      nextOptions = buildProductSelectionOptions({
        query: pending.sourceQuery,
        products: indexedCatalog,
        offset: nextOffset,
        limit: pending.options.length,
      })
    }
    if (nextOptions.length === 0) {
      return "Das sind aktuell die passendsten Treffer. Du kannst eine Nummer waehlen oder den Wunsch etwas genauer eingrenzen."
    }
    await conversationState.setPendingOptions(subjectId, {
      ...pending,
      options: nextOptions,
      offset: nextOffset,
    })
    return formatPendingOptionsMessage(pending.prompt, nextOptions)
  }

  if (parsed.action === "recipe" && profile?.profile?.pendingOptions?.options?.length) {
    const correction = extractPendingOptionsCorrection(text)
    if (correction) {
      const pending = profile.profile.pendingOptions
      const indexedCatalog = await stateStore.listAlfiesProducts()
      if (pending.kind === "category_selection" || pending.kind === "product_selection") {
        const matchingCategories = buildMatchingCategoryOptions({
          query: correction,
          products: indexedCatalog,
        })
        if (matchingCategories.length > 0) {
          await conversationState.setPendingOptions(subjectId, {
            kind: "category_selection",
            prompt: `Alles klar. Meinst du eher diese Bierarten?`,
            options: matchingCategories,
            offset: 0,
            sourceQuery: correction,
          })
          return formatPendingOptionsMessage("Alles klar. Meinst du eher diese Bierarten?", matchingCategories)
        }
      }
    }
  }

  if (parsed.action === "recipe" && profile?.profile?.pendingOptions?.options?.length) {
    const selected = resolvePendingOptionSelection(text, profile.profile.pendingOptions)
    if (selected) {
      if (profile.profile.pendingOptions.kind === "occasion_selection") {
        const indexedCatalog = await stateStore.listAlfiesProducts()
        await conversationState.clearPendingOptions(subjectId)
        const categoryQuery = selected.value === "drinks"
          ? "getraenke"
          : selected.value === "snacks"
            ? "snacks"
            : "party getraenke snacks"
        const matchingCategories = buildMatchingCategoryOptions({
          query: categoryQuery,
          products: indexedCatalog,
        })
        if (matchingCategories.length > 0) {
          await conversationState.setPendingOptions(subjectId, {
            kind: "category_selection",
            prompt: "Womit soll ich anfangen?",
            options: matchingCategories,
            offset: 0,
            sourceQuery: categoryQuery,
            selectionMode: profile.profile.pendingOptions.selectionMode,
          })
          return formatPendingOptionsMessage("Womit soll ich anfangen?", matchingCategories)
        }
      }
      if (profile.profile.pendingOptions.kind === "cart_item_selection") {
        const itemLabel = selected.value || selected.label
        const actionOptions = buildCartItemActionOptions(itemLabel, selected)
        await conversationState.setPendingOptions(subjectId, {
          kind: "cart_item_action",
          prompt: `Was moechtest du mit ${itemLabel} machen?`,
          options: actionOptions,
        })
        return formatPendingOptionsMessage(`Was moechtest du mit ${itemLabel} machen?`, actionOptions)
      }
      if (profile.profile.pendingOptions.kind === "cart_item_action" && existing) {
        await conversationState.clearPendingOptions(subjectId)
        if (selected.action === "increase") {
          const cart = changeCartItemQuantity(existing.lastCart, selected, +1)
          await stateStore.upsert(subjectId, { orderId: existing.orderId, lastCart: normalizeCart(cart) })
          return renderCartMutationReply("Ich habe die Menge erhoeht.", cart)
        }
        if (selected.action === "remove") {
          const cart = removeCartItem(existing.lastCart, selected)
          await stateStore.upsert(subjectId, { orderId: existing.orderId, lastCart: normalizeCart(cart) })
          return renderCartMutationReply("Ich habe den Artikel entfernt.", cart)
        }
        if (selected.action === "only") {
          const cart = keepOnlyCartItem(existing.lastCart, selected)
          await stateStore.upsert(subjectId, { orderId: existing.orderId, lastCart: normalizeCart(cart) })
          return renderCartMutationReply("Ich habe den Warenkorb auf diesen Artikel reduziert.", cart)
        }
        if (selected.action === "set_quantity") {
          await conversationState.setActiveProduct(subjectId, {
            product: {
              productId: selected.productId,
              sku: selected.sku,
              title: selected.value || selected.label,
              unitPriceCents: selected.unitPriceCents,
              currency: selected.currency,
            },
            question: {
              kind: "quantity_for_product",
              productTitle: selected.value || selected.label,
            },
            editMode: "update_existing_item_quantity",
          })
          return `Wie viele Einheiten ${selected.value || selected.label} moechtest du im Warenkorb haben?`
        }
      }
      await conversationState.clearPendingOptions(subjectId)
      if (profile.profile.pendingOptions.kind === "category_selection") {
        const indexedCatalog = await stateStore.listAlfiesProducts()
        const pendingSelectionMode = profile.profile.pendingOptions.selectionMode
        let categoryLabel = selected.label
        let productsForCategory = buildProductsForCategoryOptions({
          category: categoryLabel,
          products: indexedCatalog,
        })
        if (productsForCategory.length === 0) {
          const refinedCategories = buildMatchingCategoryOptions({
            query: selected.label,
            products: indexedCatalog,
          })
          if (refinedCategories.length > 1) {
            await conversationState.setPendingOptions(subjectId, {
              kind: "category_selection",
              prompt: `Was moechtest du innerhalb von ${selected.label}?`,
              options: refinedCategories,
              offset: 0,
              sourceQuery: selected.label,
              selectionMode: pendingSelectionMode,
            })
            return formatPendingOptionsMessage(`Was moechtest du innerhalb von ${selected.label}?`, refinedCategories)
          }
          if (refinedCategories[0]) {
            categoryLabel = refinedCategories[0].label
            productsForCategory = buildProductsForCategoryOptions({
              category: categoryLabel,
              products: indexedCatalog,
            })
          }
        }
        if (productsForCategory.length > 0) {
          const nextSelectionMode = pendingSelectionMode
            || (
              existing &&
              (
                profile.profile.activeEditMode === "add_to_existing_cart" ||
                isAdditiveCategoryRequest(profile.profile.latestMessage || text) ||
                !isExplicitReplaceOrNarrowRequest(profile.profile.latestMessage || text)
              )
                ? "add_to_existing_cart"
                : undefined
            )
          await conversationState.setPendingOptions(subjectId, {
            kind: "product_selection",
            prompt: `Was moechtest du aus ${categoryLabel}?`,
            options: productsForCategory,
            offset: 0,
            sourceCategory: categoryLabel,
            selectionMode: nextSelectionMode,
          })
          await conversationState.clearActiveProduct(subjectId)
          if (nextSelectionMode === "add_to_existing_cart") {
            await conversationState.setActiveProduct(subjectId, {
              product: undefined,
              question: undefined,
              editMode: "add_to_existing_cart",
            })
          }
          return formatPendingOptionsMessage(`Was moechtest du aus ${categoryLabel}?`, productsForCategory)
        }
        return `Ich habe ${selected.label} erkannt, aber aktuell keine passenden Produkte dafuer gefunden.`
      }
      await conversationState.setActiveProduct(subjectId, {
        product: selected.productId || selected.sku
          ? {
              productId: selected.productId,
              sku: selected.sku,
              title: selected.label,
              unitPriceCents: selected.unitPriceCents,
              currency: selected.currency,
            }
          : undefined,
        question: selected.productId || selected.sku
          ? {
              kind: "quantity_for_product",
              productTitle: selected.label,
            }
          : undefined,
        editMode: selected.productId || selected.sku
          ? (
              profile.profile.pendingOptions.selectionMode === "add_to_existing_cart"
                ? "add_to_existing_cart"
                : existing &&
                  profile.profile.activeEditMode === "add_to_existing_cart"
                ? "add_to_existing_cart"
                : "replace_with_single_product"
            )
          : undefined,
      })

      if (selected.productId || selected.sku) {
        return profile.profile.pendingOptions.selectionMode === "add_to_existing_cart"
          ? `Wie viele Einheiten ${selected.label} soll ich zusaetzlich in den Warenkorb legen?`
          : `Wie viele Einheiten ${selected.label} moechtest du bestellen?`
      }

      const categoryMessage = `Ich suche jetzt in der Kategorie ${selected.label}. Was genau moechtest du daraus?`
      return categoryMessage
    }
  }

  if (parsed.action === "recipe") {
    const indexedCatalog = await stateStore.listAlfiesProducts()
    if (isOccasionRequest(text)) {
      await conversationState.clearActiveProduct(subjectId)
      await conversationState.clearPendingOptions(subjectId)
      const occasionCategoryQuery = inferOccasionCategoryQuery(text)
      if (occasionCategoryQuery) {
        const matchingCategories = buildMatchingCategoryOptions({
          query: occasionCategoryQuery,
          products: indexedCatalog,
        })
        if (matchingCategories.length > 0) {
          await conversationState.setPendingOptions(subjectId, {
            kind: "category_selection",
            prompt: "Alles klar. Welche Kategorie passt am besten zu deinem Anlass?",
            options: matchingCategories,
            offset: 0,
            sourceQuery: occasionCategoryQuery,
          })
          return formatPendingOptionsMessage(
            "Alles klar. Welche Kategorie passt am besten zu deinem Anlass?",
            matchingCategories,
          )
        }
      }
      const options = buildOccasionSelectionOptions()
      await conversationState.setPendingOptions(subjectId, {
        kind: "occasion_selection",
        prompt: "Alles klar. Soll ich eher Getraenke, Snacks oder beides fuer die Party zusammenstellen?",
        options,
      })
      return formatPendingOptionsMessage(
        "Alles klar. Soll ich eher Getraenke, Snacks oder beides fuer die Party zusammenstellen?",
        options,
      )
    }
    if (isRecipeIntentMessage) {
      await conversationState.clearActiveProduct(subjectId)
      await conversationState.clearPendingOptions(subjectId)
    }
    if (existing && profile?.profile?.activeEditMode === "update_existing_item_quantity" && profile.profile.activeProductCandidate) {
      const quantity = extractStandaloneQuantity(text)
      if (quantity) {
        const cart = setCartItemQuantity(existing.lastCart, profile.profile.activeProductCandidate, quantity)
        await stateStore.upsert(subjectId, { orderId: existing.orderId, lastCart: normalizeCart(cart) })
        await conversationState.clearActiveProduct(subjectId)
        return renderCartMutationReply("Ich habe die Menge aktualisiert.", cart)
      }
    }
    if (existing && profile?.profile?.activeEditMode === "add_to_existing_cart" && profile.profile.activeProductCandidate) {
      const quantity = extractStandaloneQuantity(text)
      if (quantity) {
        const cart = addCartItem(existing.lastCart, {
          productId: profile.profile.activeProductCandidate.productId,
          sku: profile.profile.activeProductCandidate.sku,
          title: profile.profile.activeProductCandidate.title,
          quantity,
          unitPriceCents: profile.profile.activeProductCandidate.unitPriceCents,
          currency: profile.profile.activeProductCandidate.currency,
        })
        await stateStore.upsert(subjectId, { orderId: existing.orderId, lastCart: normalizeCart(cart) })
        await conversationState.recordRecipeAndCart(subjectId, {
          recipeTitle: existing.lastRecipe?.title,
          cart: normalizeCart(cart) || undefined,
        })
        await conversationState.recordShownProducts(subjectId, extractShownProducts(cart))
        await conversationState.clearActiveProduct(subjectId)
        await conversationState.recordConfirmedMutation(subjectId, profile.profile.activeProductCandidate.title)
        return applyResponsePlan(
          renderCartMutationReply(`Ich habe ${quantity}x ${profile.profile.activeProductCandidate.title} zum Warenkorb hinzugefuegt.`, cart),
          planResponse({
            kind: "mutation",
            userMessage: text,
            interactionState: profile.profile.interactionState,
          }),
        )
      }
    }
    if (!isRecipeIntentMessage && (isAdditiveCategoryRequest(text) || looksLikeCategoryFamilyRequest(text))) {
      const matchingCategories = buildMatchingCategoryOptions({
        query: text,
        products: indexedCatalog,
      })
      if (matchingCategories.length > 0) {
        await conversationState.clearActiveProduct(subjectId)
        await conversationState.setPendingOptions(subjectId, {
          kind: "category_selection",
          prompt: existing
            ? "Alles klar, ich ergaenze eine weitere Kategorie. Welche meinst du?"
            : "Welche Kategorie moechtest du durchsuchen?",
          options: matchingCategories,
          offset: 0,
          sourceQuery: text,
          selectionMode: existing && !isExplicitReplaceOrNarrowRequest(text) ? "add_to_existing_cart" : undefined,
        })
        if (existing && !isExplicitReplaceOrNarrowRequest(text)) {
          await conversationState.setActiveProduct(subjectId, {
            product: undefined,
            question: undefined,
            editMode: "add_to_existing_cart",
          })
        }
        return formatPendingOptionsMessage(
          existing
            ? "Alles klar, ich ergaenze eine weitere Kategorie. Welche meinst du?"
            : "Welche Kategorie moechtest du durchsuchen?",
          matchingCategories,
        )
      }
    }
    if (!isRecipeIntentMessage && existing && isAdditiveProductRequest(text)) {
      const additiveQuery = stripAdditiveWords(text)
      const additiveProductOptions = buildProductSelectionOptions({
        query: additiveQuery,
        products: indexedCatalog,
      })
      if (additiveProductOptions.length > 0) {
        const exactMatch = additiveProductOptions.find((option) =>
          normalizeLooseText(option.label) === normalizeLooseText(additiveQuery),
        )
        const selectedProduct = exactMatch || additiveProductOptions[0]
        if (selectedProduct && (selectedProduct.productId || selectedProduct.sku)) {
          if (!exactMatch && additiveProductOptions.length >= 2 && additiveProductOptions.length <= 5) {
            await conversationState.setPendingOptions(subjectId, {
              kind: "product_selection",
              prompt: `Welche Variante von '${additiveQuery}' soll ich zusaetzlich in den Warenkorb legen?`,
              options: additiveProductOptions,
              offset: 0,
              sourceQuery: additiveQuery,
              selectionMode: "add_to_existing_cart",
            })
            await conversationState.setActiveProduct(subjectId, {
              product: undefined,
              question: undefined,
              editMode: "add_to_existing_cart",
            })
            return formatPendingOptionsMessage(
              `Welche Variante von '${additiveQuery}' soll ich zusaetzlich in den Warenkorb legen?`,
              additiveProductOptions,
            )
          }
          await conversationState.setActiveProduct(subjectId, {
            product: {
              productId: selectedProduct.productId,
              sku: selectedProduct.sku,
              title: selectedProduct.label,
              unitPriceCents: selectedProduct.unitPriceCents,
              currency: selectedProduct.currency,
            },
            question: {
              kind: "quantity_for_product",
              productTitle: selectedProduct.label,
            },
            editMode: "add_to_existing_cart",
          })
          return `Wie viele Einheiten ${selectedProduct.label} soll ich zusaetzlich in den Warenkorb legen?`
        }
      }
    }
    if (!isRecipeIntentMessage && isCategoryBrowseRequest(text)) {
      const options = buildCategorySelectionOptions(indexedCatalog)
      if (options.length > 0) {
        await conversationState.clearActiveProduct(subjectId)
        await conversationState.setPendingOptions(subjectId, {
          kind: "category_selection",
          prompt: "Welche Kategorie moechtest du durchsuchen?",
          options,
          offset: 0,
        })
        return formatPendingOptionsMessage("Welche Kategorie moechtest du durchsuchen?", options)
      }
    }

    const productOptions = !isRecipeIntentMessage && shouldOfferProductOptions(text, profile?.profile?.pendingOptions)
      ? buildProductSelectionOptions({
          query: text,
          products: indexedCatalog,
        })
      : []
    if (productOptions.length >= 2 && productOptions.length <= 5 && isBroadSingleProductRequest(text)) {
      await conversationState.setPendingOptions(subjectId, {
        kind: "product_selection",
        prompt: `Welche Variante von '${text.trim()}' meinst du?`,
        options: productOptions,
        offset: 0,
        sourceQuery: text.trim(),
      })
      return formatPendingOptionsMessage(`Welche Variante von '${text.trim()}' meinst du?`, productOptions)
    }

    if (!isRecipeIntentMessage && !looksLikeExplicitCartMutationRequest(text)) {
      const cartEdit = cartEditService.resolve({
        message: text,
        snapshot,
        catalog: indexedCatalog,
      })
      if (cartEdit.kind === "needs_quantity") {
        await conversationState.setActiveProduct(subjectId, {
          product: {
            productId: cartEdit.product.productId,
            sku: cartEdit.product.sku,
            title: cartEdit.product.title,
            unitPriceCents: cartEdit.product.unitPriceCents,
            currency: cartEdit.product.currency,
          },
          question: {
            kind: "quantity_for_product",
            productTitle: cartEdit.product.title,
            packagingHint: cartEdit.packagingHint,
          },
          editMode: "replace_with_single_product",
        })
        return cartEdit.question
      }
      if (cartEdit.kind === "replace_with_single_product") {
        const cart = buildSingleProductCart({
          productId: cartEdit.product.productId,
          sku: cartEdit.product.sku,
          title: cartEdit.product.title,
          quantity: cartEdit.quantity,
          unitPriceCents: cartEdit.product.unitPriceCents,
          currency: cartEdit.product.currency,
        })
        const orderId = existing?.orderId || createOrderId()
        await stateStore.upsert(subjectId, {
          orderId,
          lastRecipe: { title: `Direktauswahl: ${cartEdit.product.title}` },
          lastCart: normalizeCart(cart),
        })
        await conversationState.recordRecipeAndCart(subjectId, {
          recipeTitle: `Direktauswahl: ${cartEdit.product.title}`,
          cart: normalizeCart(cart) || undefined,
        })
        await conversationState.recordShownProducts(subjectId, extractShownProducts(cart))
        await conversationState.clearActiveProduct(subjectId)
        return [
          `Ich stelle den Warenkorb auf ${cartEdit.product.title} um.`,
          "",
          `- ${cartEdit.quantity}x ${cartEdit.product.title} (${formatMoney((cartEdit.product.unitPriceCents || 0) * cartEdit.quantity, cartEdit.product.currency || "EUR")})`,
          "",
          `Zwischensumme: ${formatMoney(cart.total_cents, cart.currency)}`,
          "",
          keywordInstructions(),
        ].join("\n")
      }
    }
  }

  let effectiveAction: ConciergeAction | "status" | "channel" | "help" = parsed.action
  if (parsed.action === "recipe") {
    try {
      const extraction = await semanticIntentExtractor.extract({
        message: text,
        contextSummary: conversationState.buildContextSummary(snapshot),
      })
      const referenceResolution = referenceResolutionService.resolve({
        extraction,
        snapshot,
      })
      const governance = contextGovernanceService.evaluate({
        extraction,
        snapshot,
      })
      const route = shoppingRouter.route({
        extraction,
        referenceResolution,
        governance,
      })
      await understandingAnalytics.recordTurn({
        subjectId,
        channel: "whatsapp",
        userMessage: text,
        snapshot,
        contextSummary: conversationState.buildContextSummary(snapshot),
        extraction,
        route,
        referenceResolution,
        governance,
      })
      if (governance.should_clear_active_product) {
        await conversationState.clearActiveProduct(subjectId)
      }
      if (governance.should_clear_pending_options) {
        await conversationState.clearPendingOptions(subjectId)
      }
      if (governance.should_clear_pending_clarification) {
        await conversationState.clearPendingClarification(subjectId)
      }
      if (governance.repair_mode) {
        const currentSnapshot = await conversationState.getSnapshot(subjectId)
        await conversationState.setInteractionState(subjectId, {
          ...(currentSnapshot.profile?.interactionState || {
            phase: "disambiguation",
            last_assistant_act: "asked_clarification",
            expected_reply_type: "free_text",
            repair_mode: true,
            assumption_under_discussion: null,
          }),
          repair_mode: true,
          pending_clarification_reason: governance.repair_reason,
        })
      }
      await conversationState.recordUnderstanding(subjectId, {
        intent: extraction.primary_intent,
        entities: {
          categories: extraction.categories,
          product_queries: extraction.product_queries,
          recipe_request: extraction.recipe_request,
          cart_action: extraction.cart_action,
          references_to_previous_context: extraction.references_to_previous_context,
        },
        semantics: {
          task_type: extraction.task_type,
          dialogue_move: extraction.dialogue_move,
          selection_mode: extraction.selection_mode,
          context_relation: extraction.context_relation,
          reference_strength: extraction.reference_strength,
          clarification_needed: extraction.clarification_needed,
          clarification_reason: extraction.clarification_reason,
        },
        clarification: route.kind === "clarify" || route.kind === "unknown"
          ? {
              kind: route.kind,
              question: route.question,
              reason: extraction.clarification_reason,
            }
          : null,
      })

      if (route.kind === "help") {
        return guidedWelcomeText()
      }
      const agentOutcome = await agentConversationService.maybeHandle({
        message: text,
        extraction,
        governance,
        snapshot: await conversationState.getSnapshot(subjectId),
      })
      if (agentOutcome) {
        if (agentOutcome.cart) {
          const nextOrderId = existing?.orderId || `ord_${Date.now()}_${randomBytes(3).toString("hex")}`
          await stateStore.upsert(subjectId, {
            orderId: nextOrderId,
            lastCart: normalizeCart(agentOutcome.cart),
          })
          await conversationState.recordRecipeAndCart(subjectId, {
            recipeTitle: agentOutcome.selectedRecipeTitle || existing?.lastRecipe?.title,
            cart: normalizeCart(agentOutcome.cart) || undefined,
          })
          await conversationState.recordShownProducts(subjectId, extractShownProducts(agentOutcome.cart))
          if (agentOutcome.activeProduct) {
            await conversationState.setActiveProduct(subjectId, {
              product: agentOutcome.activeProduct,
              question: undefined,
              editMode: undefined,
            })
            await conversationState.recordConfirmedMutation(subjectId, agentOutcome.activeProduct.title)
          }
        }
        if (agentOutcome.pendingOptions) {
          await conversationState.clearActiveProduct(subjectId)
          await conversationState.setPendingOptions(subjectId, agentOutcome.pendingOptions)
        }
        if (agentOutcome.shownProducts?.length) {
          await conversationState.recordShownProducts(subjectId, agentOutcome.shownProducts)
        }
        if (agentOutcome.selectedRecipeTitle) {
          await conversationState.recordRecipeAndCart(subjectId, {
            recipeTitle: agentOutcome.selectedRecipeTitle,
            cart: existing?.lastCart,
          })
        }
        await conversationState.recordAssistantMessage(subjectId, agentOutcome.reply)
        return agentOutcome.reply
      }
      if (route.kind === "payment_status") {
        effectiveAction = "status"
      }
      if (route.kind === "checkout") {
        effectiveAction = "confirm"
      }
      if (route.kind === "payment_status") {
        return buildStatusReply({
          subjectId,
          whatsappUserId,
          existing,
        })
      }
      if (route.kind === "clarify" || route.kind === "unknown") {
        const normalizedQuestion = normalizeSemanticClarificationQuestion(route.question, text)
        const inlineOptions = extractInlineChoiceOptions(normalizedQuestion)
        if (inlineOptions.length >= 2) {
          await conversationState.clearActiveProduct(subjectId)
          await conversationState.setPendingOptions(subjectId, {
            kind: "category_selection",
            prompt: normalizedQuestion,
            options: inlineOptions,
          })
          return applyResponsePlan(
            formatPendingOptionsMessage(normalizedQuestion, inlineOptions),
            planResponse({
              kind: "options",
              userMessage: text,
              dialogueMove: extraction.dialogue_move,
              interactionState: snapshot.profile?.interactionState,
            }),
          )
        }
        return applyResponsePlan(
          normalizedQuestion,
          planResponse({
            kind: "clarify",
            userMessage: text,
            dialogueMove: extraction.dialogue_move,
            interactionState: snapshot.profile?.interactionState,
          }),
        )
      }
      if (route.kind === "cart_mutation") {
        if (!existing) {
          return "Es gibt noch keinen aktiven Warenkorb. Sag mir zuerst, was ich fuer dich zusammenstellen soll."
        }
        const indexedCatalog = await stateStore.listAlfiesProducts()
        const mutation = applyCartMutation({
          cart: existing.lastCart,
          extraction,
          catalog: indexedCatalog,
          resolvedReference: route.resolvedReference,
        })
        if (mutation.kind === "clarify") {
          return mutation.message
        }
        await stateStore.upsert(subjectId, {
          orderId: existing.orderId,
          lastCart: normalizeCart(mutation.cart),
        })
        await conversationState.recordRecipeAndCart(subjectId, {
          recipeTitle: existing.lastRecipe?.title,
          cart: normalizeCart(mutation.cart) || undefined,
        })
        await conversationState.recordShownProducts(subjectId, extractShownProducts(mutation.cart))
        await conversationState.setActiveProduct(subjectId, {
          product: mutation.activeProduct,
          question: undefined,
          editMode: undefined,
        })
        await conversationState.recordConfirmedMutation(subjectId, mutation.activeProduct?.title)
        return applyResponsePlan(
          renderCartMutationReply(mutation.message, mutation.cart),
          planResponse({
            kind: "mutation",
            userMessage: text,
            dialogueMove: extraction.dialogue_move,
            interactionState: snapshot.profile?.interactionState,
          }),
        )
      }
      await conversationState.clearPendingClarification(subjectId)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.warn(JSON.stringify({
        level: "warn",
        event: "semantic_routing_failed",
        subjectId,
        message,
      }))
    }
  }

  const clarification = buildReasonableClarification(text, { hasExistingOrder: Boolean(existing) })
  if (effectiveAction === "recipe" && clarification) {
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

  if (effectiveAction === "recipe" || effectiveAction === "test_1cent") {
    const orderId = createOrderId()
    console.log(
      JSON.stringify({
        level: "info",
        event: "concierge_recipe_request",
        messageSid,
        subjectId,
        orderId,
        action: effectiveAction,
        messagePreview: String(parsedMessage || "").slice(0, REQUEST_LOG_PREVIEW_LIMIT),
      }),
    )
    const response = await concierge.call({
      action: effectiveAction,
      message: parsedMessage,
      orderId,
      subject: { type: "whatsapp", id: phoneE164 },
    })
    const alfiesEnriched = effectiveAction === "recipe"
      ? await maybeBuildLiveAlfiesBasket({
          subjectId,
          phoneE164,
          message: parsedMessage || "",
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
    await conversationState.recordRecipeAndCart(subjectId, {
      recipeTitle: finalResponse.recipe?.title,
      cart: normalizeCart(finalResponse.cart) || undefined,
    })
    const shownProducts = extractShownProducts(finalResponse.cart)
    if (shownProducts.length > 0) {
      await conversationState.recordShownProducts(subjectId, shownProducts)
    }
    const recommendationOptions = buildReferenceSelectionOptions(shownProducts)
    if (recommendationOptions.length >= 2) {
      await conversationState.setPendingOptions(subjectId, {
        kind: "product_selection",
        prompt: "Wenn du einen der Vorschlaege direkt auswaehlen willst, antworte mit Nummer oder Produktname.",
        options: recommendationOptions,
      })
    }

    return [
      responseText(finalResponse),
      "",
      recommendationOptions.length >= 2
        ? formatPendingOptionsMessage(
            "Wenn du einen der Vorschlaege direkt auswaehlen willst, antworte mit Nummer oder Produktname.",
            recommendationOptions,
          )
        : null,
      recommendationOptions.length >= 2 ? "" : null,
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

  if (effectiveAction === "alt" && existing.lastCart?.items?.length) {
    const indexedCatalog = await stateStore.listAlfiesProducts()
    const alternatives = findAlternativesForCartItems({
      cart: existing.lastCart,
      products: indexedCatalog,
      preferences: profile?.profile?.shoppingPreferences,
    })
    if (alternatives.items.length > 0) {
      const altCartItems = alternatives.items.map(({ alternative, quantity }) => ({
        product_id: alternative.product_id,
        sku: alternative.slug || String(alternative.product_id),
        name: alternative.title,
        qty: quantity,
        unit_price_cents: alternative.price_cents || 0,
        currency: alternative.currency || "EUR",
      }))
      const altCart = recalculateCart(altCartItems, String(existing.lastCart.currency || alternatives.items[0]?.alternative.currency || "EUR"))
      await stateStore.upsert(subjectId, {
        orderId: existing.orderId,
        lastRecipe: existing.lastRecipe,
        lastCart: normalizeCart(altCart),
      })
      await conversationState.recordRecipeAndCart(subjectId, {
        recipeTitle: existing.lastRecipe?.title,
        cart: normalizeCart(altCart) || undefined,
      })
      await conversationState.recordShownProducts(subjectId, extractShownProducts(altCart))
      return [
        "Hier sind Alternativen fuer deinen aktuellen Warenkorb.",
        "",
        ...alternatives.items.map(({ originalName, alternative, quantity }) =>
          `- statt ${originalName}: ${quantity}x ${alternative.title} (${formatMoney((alternative.price_cents || 0) * quantity, alternative.currency || "EUR")})`,
        ),
        "",
        formatCartOverview(altCart),
        "",
        "Wenn du nur fuer einen einzelnen Artikel Alternativen willst, nenne den Artikel direkt, z.B. 'guenstigere Milch'.",
      ].join("\n")
    }
  }

  if (effectiveAction === "alt" || effectiveAction === "cancel") {
    const response = await concierge.call({
      action: effectiveAction,
      orderId: existing.orderId,
      cartState: existing.lastCart,
      subject: { type: "whatsapp", id: phoneE164 },
    })

    await stateStore.upsert(subjectId, {
      orderId: existing.orderId,
      lastRecipe: normalizeRecipe(response.recipe) ?? existing.lastRecipe,
      lastCart: normalizeCart(response.cart) ?? existing.lastCart,
    })

    if (effectiveAction === "cancel") {
      await conversationState.clearActiveProduct(subjectId)
      await stateStore.delete(subjectId)
      return [
        "Bestellung abgebrochen.",
        "",
        "Wenn du neu starten willst, sende einfach einen neuen Wunsch oder 'start'.",
        "",
        "Zum Beispiel:",
        "- 'Milch'",
        "- 'Getraenke fuer 6'",
        "- 'vegetarian pasta for 2'",
        "- 'Kategorien'",
      ].join("\n")
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
    "Ich helfe dir beim Einkauf ueber Alfies.",
    "Du kannst Rezepte entdecken, Zutaten fuer ein Gericht zusammenstellen, direkt nach Produkten suchen, Kategorien durchsehen und deinen Warenkorb bearbeiten.",
    "Danach kannst du Alternativen anfordern, bezahlen und den Status pruefen.",
    "Auf Wunsch beachte ich auch Praeferenzen wie cheapest, regional oder bio.",
    "",
    "So startest du:",
    "- Sende ein Gericht: 'vegetarian pasta for 2'",
    "- Oder einen Anlass: 'snacks for movie night'",
    "- Oder direkt ein Produkt: 'Milch', 'Hafermilch', 'Tegernseer Helles'",
    "- Oder eine Kategorie: 'Kategorien' oder 'zeige mir Milchprodukte'",
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
    "Du kannst mir direkt sagen, was du einkaufen moechtest. Zum Beispiel:",
    "- 'Paella fuer 2'",
    "- 'vegetarian pasta for 3'",
    "- 'Milch'",
    "- 'zeige mir Milchprodukte'",
    "- 'snacks for movie night'",
    "- 'address: Kaiserstrasse 8/7a, 1070 Wien'",
    "- 'preferences'",
    "",
    "Zum Einstieg:",
    "start = Concierge-Erklaerung",
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
  return /\b(pasta|paella|snack|snacks|drink|drinks|getranke|getränke|bier|beer|breakfast|brunch|vegetarian|vegan|bio|regional|cola|water|juice|chips|pizza|bread|brot|milk|milch|eggs|eier|party|personen|fleisch|meat|musaka|moussaka|kochen|machen)\b/.test(text)
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
  const recipeRequest = looksLikeRecipeRequest(args.message) ? resolveRecipeRequest(args.message) : null
  const catalogSearchMessage = recipeRequest
    ? recipeRequest.ingredients.join(" ")
    : args.message
  const interpretedQuery = args.message.trim()
    ? intentInterpreter
      ? await intentInterpreter.interpretCatalogQuery({
          message: catalogSearchMessage,
          contextSummary: [
            args.profile?.profile?.shoppingPreferences
              ? `preferences=${describePreferences(args.profile.profile.shoppingPreferences)}`
              : "",
            recipeRequest ? `recipe=${recipeRequest.title}` : "",
            "alfies indexed catalog search",
          ].filter(Boolean).join("; "),
        }).catch(() => fallbackCatalogQuery(catalogSearchMessage))
      : fallbackCatalogQuery(catalogSearchMessage)
    : undefined
  const resolvedFromCatalog = resolveProductsFromCatalog(
    catalogSearchMessage,
    indexedCatalog,
    args.profile?.profile?.shoppingPreferences,
    interpretedQuery,
    recipeRequest,
  )
  const resolved = resolvedFromCatalog || (!recipeRequest ? resolveProductsFromMessage(args.message, alfiesResolverRules) : null)
  if (!resolved) {
    return {
      response: args.response,
      note: indexedCatalog.length > 0
        ? recipeRequest
          ? [
              `Ich habe noch keine saubere Zutatenzuordnung fuer ${recipeRequest.title} im Alfies-Katalog gefunden.`,
              "Ich kann dir aber weiterhelfen, wenn du das Gericht etwas genauer beschreibst oder einzelne Zutaten nennst.",
            ].join("\n")
          : explainCatalogMiss(args.message, indexedCatalog, interpretedQuery)
        : "Alfies-Session ist bereit, aber fuer diese Anfrage gibt es noch keine konfigurierte Produktzuordnung im Bot.",
    }
  }

  const matchedProducts = matchIndexedProductsById(indexedCatalog, resolved.lines)
  const sessionId = args.profile?.profile?.alfiesSessionId
  if (!sessionId) {
    if (matchedProducts.length > 0) {
      const cart = buildIndexedSuggestionCart(matchedProducts, resolved.lines)
      const suggestionTitle = recipeRequest
        ? `Zutaten fuer ${recipeRequest.title}`
        : buildIndexedSuggestionTitle(args.message, matchedProducts)
      return {
        response: {
          ...args.response,
          recipe: { title: suggestionTitle },
          cart,
          text: [
            suggestionTitle,
            "",
            recipeRequest
              ? "Ich habe passende Zutaten im Alfies-Katalog gefunden."
              : "Ich habe passende Produkte im Alfies-Katalog gefunden.",
            ...formatIndexedSuggestionLines(matchedProducts, resolved.lines),
            "",
            `Zwischensumme: ${formatMoney(cart.total_cents, cart.currency)}`,
          ].join("\n"),
        },
        note: [
          recipeRequest
            ? `Zutaten fuer ${recipeRequest.title} gefunden${resolved.label ? ` (${resolved.label})` : ""}.`
            : `Katalogtreffer gefunden${resolved.label ? ` (${resolved.label})` : ""}.`,
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
    product_id: product.product_id,
    sku: product.slug || String(product.product_id),
    name: product.title,
    qty: quantity,
    unit_price_cents: product.price_cents || 0,
    currency: product.currency || "EUR",
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
      product_id: Number.isFinite(Number(line.product || line.id)) ? Math.trunc(Number(line.product || line.id)) : undefined,
      sku: String(line.product || line.id || "alfies-item"),
      name: String(line.productTitle || line.name || "Alfies Product"),
      qty: Number.isFinite(Number(line.quantity)) ? Math.trunc(Number(line.quantity)) : 1,
      unit_price_cents: Number.isFinite(Number(line.priceInclTax))
        ? Math.round(Number(line.priceInclTax) * 100)
        : undefined,
      currency: String(basket.currency || "EUR"),
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

function extractShownProducts(cart: { items?: unknown[] } | undefined): Array<{
  productId?: number
  sku?: string
  title: string
  unitPriceCents?: number
  currency?: string
}> {
  const items = Array.isArray(cart?.items) ? cart.items : []
  return items
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
    .map((item) => ({
      productId: typeof item.product_id === "number" ? Math.trunc(item.product_id) : undefined,
      sku: typeof item.sku === "string" ? item.sku : undefined,
      title: String(item.name || item.title || "").trim(),
      unitPriceCents: typeof item.unit_price_cents === "number" ? Math.trunc(item.unit_price_cents) : undefined,
      currency: typeof item.currency === "string" ? item.currency : undefined,
    }))
    .filter((item) => item.title)
    .slice(0, 8)
}

function buildSingleProductCart(args: {
  productId?: number
  sku?: string
  title: string
  quantity: number
  unitPriceCents?: number
  currency?: string
}): { items: unknown[]; total_cents: number; currency: string } {
  const unitPriceCents = Math.max(0, Math.trunc(Number(args.unitPriceCents || 0)))
  const quantity = Math.max(1, Math.trunc(Number(args.quantity || 1)))
  const currency = args.currency || "EUR"
  return {
    items: [
      {
        product_id: args.productId,
        sku: args.sku || String(args.productId || args.title),
        name: args.title,
        qty: quantity,
        unit_price_cents: unitPriceCents,
        currency,
      },
    ],
    total_cents: quantity * unitPriceCents,
    currency,
  }
}

function addCartItem(
  cart: { items?: unknown[]; total_cents?: number; currency?: string } | undefined,
  args: {
    productId?: number
    sku?: string
    title: string
    quantity: number
    unitPriceCents?: number
    currency?: string
  },
): { items: unknown[]; total_cents: number; currency: string } {
  const items = Array.isArray(cart?.items) ? [...cart.items] : []
  const quantity = Math.max(1, Math.trunc(Number(args.quantity || 1)))
  const unitPriceCents = Math.max(0, Math.trunc(Number(args.unitPriceCents || 0)))
  const currency = String(cart?.currency || args.currency || "EUR")
  const existingIndex = items.findIndex((item) => {
    const record = item && typeof item === "object" ? (item as Record<string, unknown>) : {}
    return (
      (typeof record.product_id === "number" && args.productId != null && Math.trunc(record.product_id) === args.productId) ||
      (typeof record.sku === "string" && args.sku && record.sku === args.sku) ||
      normalizeLooseText(String(record.name || record.title || "")) === normalizeLooseText(args.title)
    )
  })
  if (existingIndex >= 0) {
    const record = { ...(items[existingIndex] as Record<string, unknown>) }
    record.qty = Math.max(1, Math.trunc(Number(record.qty || 1)) + quantity)
    items[existingIndex] = record
    return recalculateCart(items, currency)
  }
  items.push({
    product_id: args.productId,
    sku: args.sku || String(args.productId || args.title),
    name: args.title,
    qty: quantity,
    unit_price_cents: unitPriceCents,
    currency,
  })
  return recalculateCart(items, currency)
}

function formatCartOverview(cart: { items?: unknown[]; total_cents?: number; currency?: string } | undefined): string {
  const items = Array.isArray(cart?.items) ? cart.items : []
  const lines = items
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
    .map((item, index) => {
      const qty = Math.trunc(Number(item.qty || 1))
      const name = String(item.name || item.title || "Artikel")
      const lineTotal = Math.trunc(Number(item.unit_price_cents || 0)) * qty
      const currency = String(item.currency || cart?.currency || "EUR")
      return `${index + 1}. ${qty}x ${name} (${formatMoney(lineTotal, currency)})`
    })
  return [
    "Aktueller Warenkorb:",
    ...lines,
    "",
    `Zwischensumme: ${formatMoney(Math.trunc(Number(cart?.total_cents || 0)), String(cart?.currency || "EUR"))}`,
  ].join("\n")
}

function renderCartMutationReply(prefix: string, cart: { items?: unknown[]; total_cents?: number; currency?: string }): string {
  return [
    prefix,
    "",
    formatCartOverview(cart),
    "",
    "Naechste Schritte: 'order' zum Bestellen, 'Warenkorb' zum Bearbeiten, 'alt' fuer Alternativen.",
    "Du kannst auch etwas ergaenzen, z.B. 'auch Milch' oder 'fuege 2x Hafermilch hinzu'.",
  ].join("\n")
}

function isCartShowOrEditTrigger(text: string): boolean {
  const normalized = normalizeLooseText(text)
  return /\b(warenkorb|cart|zeige warenkorb|show cart|bearbeite warenkorb|edit cart)\b/.test(normalized)
}

function extractStandaloneQuantity(text: string): number | null {
  const normalized = normalizeLooseText(text)
  const match = normalized.match(/^\d{1,3}$/)
  if (!match) return null
  const parsed = Math.trunc(Number(match[0]))
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

function changeCartItemQuantity(
  cart: { items?: unknown[]; total_cents?: number; currency?: string } | undefined,
  selected: { sku?: string; value: string; unitPriceCents?: number; currency?: string },
  delta: number,
): { items: unknown[]; total_cents: number; currency: string } {
  const items = Array.isArray(cart?.items) ? [...cart.items] : []
  const nextItems = items.map((item) => {
    const record = item && typeof item === "object" ? { ...(item as Record<string, unknown>) } : {}
    if (matchesCartItem(record, selected)) {
      const currentQty = Math.max(1, Math.trunc(Number(record.qty || 1)))
      record.qty = Math.max(1, currentQty + delta)
    }
    return record
  })
  return recalculateCart(nextItems, String(cart?.currency || selected.currency || "EUR"))
}

function setCartItemQuantity(
  cart: { items?: unknown[]; total_cents?: number; currency?: string } | undefined,
  selected: { sku?: string; title?: string },
  quantity: number,
): { items: unknown[]; total_cents: number; currency: string } {
  const items = Array.isArray(cart?.items) ? [...cart.items] : []
  const nextItems = items.map((item) => {
    const record = item && typeof item === "object" ? { ...(item as Record<string, unknown>) } : {}
    if (matchesCartItem(record, { sku: selected.sku, value: selected.title || "" })) {
      record.qty = quantity
    }
    return record
  })
  return recalculateCart(nextItems, String(cart?.currency || "EUR"))
}

function removeCartItem(
  cart: { items?: unknown[]; total_cents?: number; currency?: string } | undefined,
  selected: { sku?: string; value: string },
): { items: unknown[]; total_cents: number; currency: string } {
  const items = Array.isArray(cart?.items) ? cart.items : []
  const nextItems = items.filter((item) => {
    const record = item && typeof item === "object" ? (item as Record<string, unknown>) : {}
    return !matchesCartItem(record, selected)
  })
  return recalculateCart(nextItems, String(cart?.currency || "EUR"))
}

function keepOnlyCartItem(
  cart: { items?: unknown[]; total_cents?: number; currency?: string } | undefined,
  selected: { sku?: string; value: string },
): { items: unknown[]; total_cents: number; currency: string } {
  const items = Array.isArray(cart?.items) ? cart.items : []
  const nextItems = items.filter((item) => {
    const record = item && typeof item === "object" ? (item as Record<string, unknown>) : {}
    return matchesCartItem(record, selected)
  })
  return recalculateCart(nextItems, String(cart?.currency || "EUR"))
}

function matchesCartItem(item: Record<string, unknown>, selected: { sku?: string; value: string }): boolean {
  const sku = typeof item.sku === "string" ? item.sku : undefined
  const name = String(item.name || item.title || "").trim()
  return (selected.sku && sku === selected.sku) || normalizeLooseText(name) === normalizeLooseText(selected.value)
}

function recalculateCart(items: unknown[], currency: string): { items: unknown[]; total_cents: number; currency: string } {
  const total = items
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
    .reduce((sum, item) => sum + Math.trunc(Number(item.qty || 0)) * Math.trunc(Number(item.unit_price_cents || 0)), 0)
  return {
    items,
    total_cents: total,
    currency,
  }
}

function isBroadSingleProductRequest(text: string): boolean {
  const normalized = normalizeLooseText(text)
  if (isAdditiveCategoryRequest(text) || looksLikeCategoryFamilyRequest(text)) return false
  return /\b(milch|milk|bier|beer|joghurt|yogurt|wein|wine|saft|juice|zahnpasta|toothpaste|shampoo|seife|soap)\b/.test(normalized) &&
    !/\b(vollmilch|whole milk|hafer|oat|tegernseer|falco|erdinger|rotwein|weisswein|elmex|sensodyne|colgate)\b/.test(normalized)
}

function isCategoryBrowseRequest(text: string): boolean {
  const normalized = normalizeLooseText(text)
  return /\b(kategorie|kategorien|browse|browse categories|durchsuche|zeig kategorien|show categories)\b/.test(normalized)
}

function isOccasionRequest(text: string): boolean {
  const normalized = normalizeLooseText(text)
  if (
    /\b(party|feiern|feier|abend mit|gaeste|gaste)\b/.test(normalized) &&
    /\b(\d{1,2}\s+leuten|\d{1,2}\s+personen|fuer\s+\d{1,2}|for\s+\d{1,2})\b/.test(normalized)
  ) {
    return true
  }
  return /\b(fernsehabend|movie night|filmabend|spieleabend|game night|picknick|brunch|fruehstuck|fruhstuck)\b/.test(normalized) &&
    /\b(snack|snacks|chips|getraenke|getranke|drinks|bier|beer|wein|wine|cola|wasser|water|saft|juice)\b/.test(normalized)
}

function inferOccasionCategoryQuery(text: string): string | null {
  const normalized = normalizeLooseText(text)
  const wantsSnacks = /\b(snack|snacks|chips|nuesse|nusse|nuts)\b/.test(normalized)
  const wantsDrinks = /\b(getraenke|getranke|drinks|bier|beer|wein|wine|cola|wasser|water|saft|juice)\b/.test(normalized)
  if (wantsSnacks && wantsDrinks) return "party getraenke snacks"
  if (wantsSnacks) return "snacks"
  if (wantsDrinks) return "getraenke"
  return null
}

function isRecipeCookingIntent(text: string): boolean {
  const normalized = normalizeLooseText(text)
  return (
    /\b(rezept|rezeptvorschlag)\b/.test(normalized) ||
    (/\b(ich moechte|ich möchte|ich will)\b/.test(normalized) &&
      /\b(machen|kochen|ausprobieren)\b/.test(normalized) &&
      /\b(musaka|moussaka|tacos|paella|pasta|curry|lasagne|lasagna)\b/.test(normalized))
  )
}

function shouldResetInteractiveState(text: string): boolean {
  return isOccasionRequest(text) || isRecipeCookingIntent(text) || isAdditiveCategoryRequest(text) || looksLikeCategoryFamilyRequest(text)
}

function isAdditiveCategoryRequest(text: string): boolean {
  const normalized = normalizeLooseText(text)
  return /\b(auch|zusatzlich|zusätzlich|noch|dazu|add)\b/.test(normalized) &&
    /\b(milch|milk|milchprodukte|milk products|joghurt|yogurt|kaese|käse|frischkaese|frischkäse|butter|bier|beer|wein|wine|fleisch|meat|brot|wurst|schinken|speck|putzmittel|reinigungsmittel|putz|klopapier|toilettenpapier|haushaltspapier|kuechenrolle|taschentucher|taschentuecher|kaerperpflege|körperpflege|baby|haustier|pasta|reis|feinkost|antipasti|konserven|fruehstuck|frühstück|muesli|müsli)\b/.test(normalized)
}

function isExplicitReplaceOrNarrowRequest(text: string): boolean {
  const normalized = normalizeLooseText(text)
  return /\b(nur|only|just|statt|stattdessen|ersetz|ersetze|ersetzen|tausch|tausche|wechsel|wechsle|umstellen|reduzier|reduziere)\b/.test(normalized)
}

function looksLikeCategoryFamilyRequest(text: string): boolean {
  const normalized = normalizeLooseText(text)
  return /\b(milchprodukte|milk products|molkerei|dairy products|getraenke|getränke|snacks|bier|beer|fleisch|meat|wurst|kaese|käse|frischkaese|frischkäse|brot|brote|milch|joghurt|reinigungsmittel|putzmittel|putz|haushalt|klopapier|toilettenpapier|haushaltspapier|kuechenrolle|taschentucher|taschentuecher|koerperpflege|körperpflege|baby|haustier|pasta|reis|feinkost|antipasti|konserven|fruehstuck|frühstück|muesli|müsli|schinken|speck)\b/.test(normalized) ||
    /\b(zeige mir alle|show me all)\b/.test(normalized)
}

function shouldOfferProductOptions(
  text: string,
  pendingOptions: ConversationProfile["pendingOptions"] | undefined,
): boolean {
  if (pendingOptions?.kind === "product_selection") return false
  return text.trim().length > 0
}

function looksLikeExplicitCartMutationRequest(text: string): boolean {
  const normalized = normalizeLooseText(text)
  return /\b(entfern|losch|loesch|remove|delete)\b/.test(normalized) ||
    /\b(hinzu|add|dazu|pack|nimm)\b/.test(normalized) ||
    /\b(setz|setze|update|menge|quantity)\b/.test(normalized)
}

function isMoreOptionsRequest(text: string): boolean {
  const normalized = normalizeLooseText(text)
  return /^(mehr|noch mehr|weitere|weitere optionen|mehr optionen|more|show more|mehr kategorien|mehr davon|mehr bierarten|gibt es mehr|gibt es noch mehr|hast du mehr|hast du noch mehr|gibt s mehr|gibt s noch mehr)$/.test(normalized)
}

function extractPendingOptionsCorrection(text: string): string | null {
  const normalized = normalizeLooseText(text)
  const stripped = normalized
    .replace(/^(nein\s+)?(ich\s+meine|ich\s+suche|eher)\s+/, "")
    .trim()
  if (!stripped || stripped === normalized) return null
  return stripped
}

function isAdditiveProductRequest(text: string): boolean {
  const normalized = normalizeLooseText(text)
  if (isMoreOptionsRequest(normalized)) return false
  return /\b(auch|noch|zusatzlich|zusätzlich|dazu|hinzu|add)\b/.test(normalized) &&
    stripAdditiveWords(normalized).length >= 3
}

function stripAdditiveWords(text: string): string {
  return normalizeLooseText(text)
    .replace(/\b(und|auch|noch|zusatzlich|zusätzlich|dazu|hinzu|add|bitte|hast|du|habt|ihr|ich|brauche|moechte|möchte|will|suche|gibt|es|mir|mal)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

function normalizeLooseText(value: string): string {
  return String(value || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\w\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

function normalizeSemanticClarificationQuestion(question: string, originalMessage: string): string {
  const raw = String(question || "").trim()
  if (!raw) return "Kannst du deinen Wunsch bitte etwas genauer beschreiben?"

  if (/\b(do you want|are you looking|information about it|add .* to your cart)\b/i.test(raw)) {
    const normalizedMessage = normalizeLooseText(originalMessage)
    if (/\b(klopapier|toilettenpapier|haushaltspapier|kuechenrolle|taschentucher|taschentuecher)\b/.test(normalizedMessage)) {
      return "Welche Art von Klopapier oder Haushaltspapier suchst du?"
    }
    if (/\b(putzmittel|reinigungsmittel|wc|haushalt)\b/.test(normalizedMessage)) {
      return "Welche Art von Reinigungs- oder Putzmittel suchst du genau?"
    }
    return "Meinst du ein konkretes Produkt oder soll ich dir passende Varianten zeigen?"
  }

  return raw
}

function rememberReplyForMessageSid(messageSid: string, reply: string): void {
  recentRepliesByMessageSid.set(messageSid, reply)
  while (recentRepliesByMessageSid.size > 200) {
    const firstKey = recentRepliesByMessageSid.keys().next().value
    if (!firstKey) break
    recentRepliesByMessageSid.delete(firstKey)
  }
}

async function buildStatusReply(args: {
  subjectId: string
  whatsappUserId: string
  existing: Awaited<ReturnType<FileStateStore["get"]>>
}): Promise<string> {
  if (!args.existing) {
    return guidedNoActiveOrderText()
  }
  const channelLink = await stateStore.getChannelLink(args.whatsappUserId)
  const capacityLines = await buildManagedCapacityLinesForWhatsApp({
    subjectHeader: channelLink?.valuya_protocol_subject_header,
  })
  if (confirmInFlightBySubject.has(args.subjectId)) {
    return [
      `Aktive Bestellung: ${args.existing.orderId}`,
      "Status: Verarbeitung läuft (Zahlung/Bestellung wird ausgeführt).",
      "",
      ...capacityLines,
      ...(capacityLines.length > 0 ? [""] : []),
      keywordInstructions(),
    ].join("\n")
  }
  const total = typeof args.existing.lastCart?.total_cents === "number"
    ? `${args.existing.lastCart.total_cents / 100} EUR`
    : "unbekannt"
  return [
    `Aktive Bestellung: ${args.existing.orderId}`,
    `Letzter Warenkorb: ${total}`,
    "",
    ...capacityLines,
    ...(capacityLines.length > 0 ? [""] : []),
    keywordInstructions(),
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

function writeJson(res: any, status: number, body: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" })
  res.end(JSON.stringify(body))
}

async function safeParseJsonResponse(response: Response): Promise<unknown> {
  const text = await response.text()
  if (!text) return {}
  try {
    return JSON.parse(text)
  } catch {
    return { raw: text }
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

async function parseJsonRequestBody(req: any): Promise<Record<string, unknown>> {
  const raw = await readRequestBody(req)
  if (!raw.trim()) return {}
  const parsed = JSON.parse(raw)
  return parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : {}
}

function isValidAgentToolAuth(req: any): boolean {
  if (!ALFIES_BACKEND_API_KEY) return false
  return String(req.headers.authorization || "") === `Bearer ${ALFIES_BACKEND_API_KEY}`
}

type AgentToolConversation = {
  latest_message?: string
  conversation_summary?: string
  cart_summary?: {
    items?: Array<{ title: string; qty: number }>
    subtotal_cents?: number | null
    currency?: string | null
  }
  last_shown_options?: Array<{ id: string; label: string; kind: "category" | "product" | "cart_item" }>
  pending_question?: {
    kind: "choice" | "yes_no" | "quantity" | "clarification"
    prompt: string
  } | null
  preferences?: string[]
  address_known?: boolean
}

type AgentToolRequest = {
  args?: Record<string, unknown>
  conversation?: AgentToolConversation
}

async function dispatchAgentToolRequest(tool: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const request = normalizeAgentToolRequest(body)
  switch (tool) {
    case "browse_categories":
      return handleAgentBrowseCategories(request)
    case "browse_products":
      return handleAgentBrowseProducts(request)
    case "recipe_to_products":
      return handleAgentRecipeToProducts(request)
    case "show_cart":
      return handleAgentShowCart(request)
    case "add_to_cart":
      return handleAgentAddToCart(request)
    case "replace_cart_with":
      return handleAgentReplaceCartWith(request)
    case "start_checkout":
      return handleAgentStartCheckout(request)
    default:
      return { ok: false, error: "unknown_tool" }
  }
}

function normalizeAgentToolRequest(body: Record<string, unknown>): AgentToolRequest {
  return {
    args: body.args && typeof body.args === "object" ? body.args as Record<string, unknown> : {},
    conversation: body.conversation && typeof body.conversation === "object" ? body.conversation as AgentToolConversation : {},
  }
}

async function handleAgentBrowseCategories(body: AgentToolRequest): Promise<Record<string, unknown>> {
  const query = String(body.args?.query || body.conversation?.latest_message || "").trim()
  const page = normalizeAgentToolPage(body.args?.page)
  const result = await catalogService.browseCategories({ query, page })
  return {
    ok: true,
    prompt: result.prompt,
    hasMore: result.hasMore,
    options: result.options.map(toAgentOption),
  }
}

async function handleAgentBrowseProducts(body: AgentToolRequest): Promise<Record<string, unknown>> {
  const query = body.args?.query ? String(body.args.query) : undefined
  const category = body.args?.category ? String(body.args.category) : undefined
  const page = normalizeAgentToolPage(body.args?.page)
  const result = await catalogService.browseProducts({ query, category, page })
  return {
    ok: true,
    prompt: result.prompt,
    hasMore: result.hasMore,
    options: result.options.map(toAgentOption),
  }
}

async function handleAgentRecipeToProducts(body: AgentToolRequest): Promise<Record<string, unknown>> {
  const query = String(body.args?.query || body.conversation?.latest_message || "").trim()
  const preferences = toAgentShoppingPreferences(body.conversation?.preferences)
  const result = await catalogService.recipeToProducts({ query, preferences })
  if (!result) {
    return { ok: false, error: `Ich habe fuer '${query}' noch keine gute Rezept-Zuordnung.` }
  }
  return {
    ok: true,
    prompt: `Fuer ${result.recipeTitle} habe ich diese passenden Zutaten gefunden:`,
    recipeTitle: result.recipeTitle,
    unresolvedIngredients: result.unresolvedIngredients,
    options: result.options.map(toAgentOption),
  }
}

async function handleAgentShowCart(body: AgentToolRequest): Promise<Record<string, unknown>> {
  return {
    ok: true,
    cart: normalizeAgentCartSummary(body.conversation?.cart_summary),
  }
}

async function handleAgentAddToCart(body: AgentToolRequest): Promise<Record<string, unknown>> {
  return handleAgentResolvedCartMutation(body, "append")
}

async function handleAgentReplaceCartWith(body: AgentToolRequest): Promise<Record<string, unknown>> {
  return handleAgentResolvedCartMutation(body, "replace")
}

async function handleAgentResolvedCartMutation(
  body: AgentToolRequest,
  mode: "append" | "replace",
): Promise<Record<string, unknown>> {
  const query = String(body.args?.query || body.conversation?.latest_message || "").trim()
  const quantity = normalizeAgentToolQuantity(body.args?.quantity)
  const resolution = await catalogService.resolveDirectProductQuery(query)

  if (resolution.kind === "category_browse") {
    return {
      ok: true,
      prompt: resolution.prompt,
      options: resolution.options.map(toAgentOption),
      hasMore: false,
    }
  }

  if (resolution.kind === "product_browse") {
    return {
      ok: true,
      prompt: resolution.prompt,
      options: resolution.options.map(toAgentOption),
      hasMore: false,
    }
  }

  if (resolution.kind !== "resolved" || !resolution.option.productId) {
    return { ok: false, error: `Ich konnte '${query}' nicht sicher einem Produkt zuordnen.` }
  }

  const product = await catalogService.showProductDetails(resolution.option.productId)
  if (!product) {
    return { ok: false, error: `Produkt fuer '${query}' wurde nicht gefunden.` }
  }

  const mutation = applyResolvedCartMutation({
    cart: mode === "append" ? denormalizeAgentCartSummary(body.conversation?.cart_summary) : undefined,
    product,
    quantity,
    mode,
  })

  if (mutation.kind !== "mutated") {
    return { ok: false, error: mutation.message }
  }

  return {
    ok: true,
    message: mutation.message,
    cart: normalizeAgentCartSummary({
      items: mutation.cart.items,
      total_cents: mutation.cart.total_cents,
      currency: mutation.cart.currency,
    }),
  }
}

async function handleAgentStartCheckout(body: AgentToolRequest): Promise<Record<string, unknown>> {
  const hasItems = Array.isArray(body.conversation?.cart_summary?.items) && body.conversation!.cart_summary!.items.length > 0
  if (!hasItems) {
    return {
      ok: true,
      checkout: {
        state: "empty_cart",
        message: "Dein Warenkorb ist noch leer.",
      },
    }
  }
  if (!body.conversation?.address_known) {
    return {
      ok: true,
      checkout: {
        state: "needs_address",
        message: "Ich brauche noch deine Lieferadresse. Sende: address: Strasse Hausnummer, PLZ Stadt",
      },
    }
  }
  return {
    ok: true,
    checkout: {
      state: "payment_required",
      message: "Checkout ist bereit. Bitte nutze den bestehenden Zahlungsflow deines Bots.",
    },
  }
}

function toAgentOption(option: PendingOption): Record<string, unknown> {
  return {
    id: option.id,
    label: option.label,
    productId: option.productId,
    priceCents: option.unitPriceCents,
    currency: option.currency,
  }
}

function normalizeAgentToolPage(value: unknown): number {
  const parsed = Math.trunc(Number(value || 0))
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0
}

function normalizeAgentToolQuantity(value: unknown): number {
  const parsed = Math.trunc(Number(value || 1))
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1
}

function toAgentShoppingPreferences(preferences: string[] | undefined): ShoppingPreferences | undefined {
  if (!Array.isArray(preferences) || preferences.length === 0) return undefined
  const normalized = new Set(preferences.map((value) => String(value).trim().toLowerCase()))
  return {
    cheapest: normalized.has("cheapest"),
    regional: normalized.has("regional"),
    bio: normalized.has("bio"),
  }
}

function normalizeAgentCartSummary(
  cartSummary: AgentToolConversation["cart_summary"] | { items?: unknown[]; total_cents?: number; currency?: string } | undefined,
): Record<string, unknown> {
  if (Array.isArray(cartSummary?.items) && cartSummary.items.length > 0 && typeof cartSummary.items[0] === "object") {
    const rows = cartSummary.items as Array<Record<string, unknown>>
    const looksRuntimeCart = rows.some((item) => "unit_price_cents" in item || "name" in item || "title" in item)
    if (looksRuntimeCart) {
      const currency = String((cartSummary as { currency?: string }).currency || "EUR")
      return {
        items: rows.map((item) => ({
          title: String(item.name || item.title || "Artikel"),
          qty: Math.max(1, Math.trunc(Number(item.qty || 1))),
          line_total_cents: Math.trunc(Number(item.line_total_cents || Number(item.qty || 1) * Number(item.unit_price_cents || 0))),
        })),
        subtotal_cents: Math.trunc(Number((cartSummary as { total_cents?: number }).total_cents || 0)),
        currency,
      }
    }
  }
  const summary = cartSummary as AgentToolConversation["cart_summary"] | undefined
  return {
    items: Array.isArray(summary?.items)
      ? summary.items.map((item) => ({
          title: item.title,
          qty: item.qty,
        }))
      : [],
    subtotal_cents: Math.trunc(Number(summary?.subtotal_cents || 0)),
    currency: String(summary?.currency || "EUR"),
  }
}

function denormalizeAgentCartSummary(
  summary: AgentToolConversation["cart_summary"] | undefined,
): { items: unknown[]; total_cents: number; currency: string } {
  return {
    items: Array.isArray(summary?.items)
      ? summary.items.map((item) => ({
          name: item.title,
          qty: Math.max(1, Math.trunc(Number(item.qty || 1))),
          unit_price_cents: 0,
          currency: String(summary?.currency || "EUR"),
        }))
      : [],
    total_cents: Math.trunc(Number(summary?.subtotal_cents || 0)),
    currency: String(summary?.currency || "EUR"),
  }
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
      "Ich bin jetzt dein Alfies Concierge auf WhatsApp.",
      "Schreib einfach ganz normal, worauf du Lust hast, und ich stelle dir den Einkauf zusammen.",
      "",
      "So klappt es am besten:",
      "- Sag direkt, was du suchst, zum Beispiel ein Gericht, eine Kategorie oder ein Produkt.",
      "- Nenne wichtige Details gleich mit, zum Beispiel 'fuer 4', 'vegetarisch', 'ohne Alkohol' oder 'guenstig'.",
      "- Wenn ich dir eine Liste schicke, antworte einfach mit einer Zahl, 'mehr' oder 'zeige alle'.",
      "- Wenn mein Vorschlag passt, schreib 'alles'. Fuer Zahlung und Stand kannst du 'checkout' und 'status' schreiben.",
      "",
      "Zum Beispiel:",
      "- 'Ich moechte Paella machen heute'",
      "- 'Ich brauche Getraenke fuer heute abend'",
      "- 'Pack Bio-Milch dazu'",
      "- 'Zeig mir Snacks'",
      "",
      "Wenn du willst, kannst du auch 'start' schreiben und ich erklaere dir kurz, wie wir am besten zusammen einkaufen.",
    ].join("\n")
  }

  console.warn(
    JSON.stringify({
      level: "warn",
      event: "link_failure",
      whatsappUserId: args.whatsappUserId,
      code: result.code,
      reason: result.message,
      ...(result.code === "guard_unavailable"
        ? { note: "check guard_channel_response log for redeem/resolve status and payload" }
        : {}),
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
        await conversationState.recordPaymentHandoff(args.subjectId, {
          status: "awaiting_checkout",
          checkoutId: payment.valuyaOrderId,
          checkoutUrl: payment.checkoutUrl,
          updatedAt: new Date().toISOString(),
        })
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

    await conversationState.recordPaymentHandoff(args.subjectId, {
      status: "paid",
      checkoutId: payment.valuyaOrderId,
      updatedAt: new Date().toISOString(),
    })

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

async function maybeHandleWithAgentBot(args: {
  whatsappUserId: string
  body: string
  profileName?: string
  mode: "off" | "shadow" | "primary"
}): Promise<
  | { kind: "skipped" }
  | { kind: "shadow" }
  | { kind: "primary"; reply: string }
> {
  if (args.mode === "off") return { kind: "skipped" }
  if (!WHATSAPP_AGENT_BASE_URL) return { kind: "skipped" }
  if (extractLinkToken(args.body)) return { kind: "skipped" }
  if (!isAgentRolloutSelected(args.whatsappUserId)) return { kind: "skipped" }

  try {
    const response = await fetch(`${WHATSAPP_AGENT_BASE_URL}/internal/message`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        ...(WHATSAPP_AGENT_INTERNAL_API_TOKEN
          ? { "X-Agent-Internal-Token": WHATSAPP_AGENT_INTERNAL_API_TOKEN }
          : {}),
      },
      body: JSON.stringify({
        whatsappUserId: args.whatsappUserId,
        body: args.body,
        profileName: args.profileName,
      }),
    })
    const payload = await safeParseJsonResponse(response)
    const record = payload && typeof payload === "object" ? payload as Record<string, unknown> : {}
    const reply = typeof record.reply === "string" ? record.reply.trim() : ""
    if (!response.ok || !reply) {
      console.warn(JSON.stringify({
        level: "warn",
        event: "whatsapp_agent_forward_failed",
        mode: args.mode,
        whatsapp_user_id: args.whatsappUserId,
        status: response.status,
        response_body: record,
      }))
      return { kind: "skipped" }
    }

    if (args.mode === "shadow") {
      console.log(JSON.stringify({
        level: "info",
        event: "whatsapp_agent_shadow_reply",
        whatsapp_user_id: args.whatsappUserId,
        reply_preview: reply.slice(0, REQUEST_LOG_PREVIEW_LIMIT),
      }))
      return { kind: "shadow" }
    }

    console.log(JSON.stringify({
      level: "info",
      event: "whatsapp_agent_primary_reply",
      whatsapp_user_id: args.whatsappUserId,
      reply_preview: reply.slice(0, REQUEST_LOG_PREVIEW_LIMIT),
    }))
    return { kind: "primary", reply }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.warn(JSON.stringify({
      level: "warn",
      event: "whatsapp_agent_forward_error",
      mode: args.mode,
      whatsapp_user_id: args.whatsappUserId,
      message,
    }))
    return { kind: "skipped" }
  }
}

function isAgentRolloutSelected(whatsappUserId: string): boolean {
  if (WHATSAPP_AGENT_ROLLOUT_PERCENT >= 100) return true
  if (WHATSAPP_AGENT_ROLLOUT_PERCENT <= 0) return false
  return stablePercentBucket(whatsappUserId) < WHATSAPP_AGENT_ROLLOUT_PERCENT
}

function stablePercentBucket(value: string): number {
  let hash = 0
  for (const ch of String(value || "")) {
    hash = ((hash * 31) + ch.charCodeAt(0)) >>> 0
  }
  return hash % 100
}

function clampRolloutPercent(value: string | undefined): number {
  const parsed = Number(value || "100")
  if (!Number.isFinite(parsed)) return 100
  return Math.max(0, Math.min(100, Math.trunc(parsed)))
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
