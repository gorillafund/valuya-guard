import {
  buildMarketplaceSessionSnapshot,
  buildCheckoutPreparedReply as buildCheckoutPreparedReplyCore,
  buildPaymentConfirmedReply as buildPaymentConfirmedReplyCore,
  buildTransactionLines as buildTransactionLinesCore,
  decideMarketplaceStatus,
  readMarketplaceSessionState,
  readMarketplaceTransaction as readMarketplaceTransactionCore,
} from "@valuya/marketplace-agent-core"
import type {
  AgentToolCall,
  AgentToolDefinition,
  AgentTurnResult,
  ConversationSession,
  LinkedSubject,
} from "../domain/types.js"
import type { AgentRuntime } from "../ports/AgentRuntime.js"
import { summarizePlannerDecision, type ShoppingPlanner, type ShoppingPlannerDecision } from "./ShoppingPlanner.js"

const DEFAULT_BROWSE_LIMIT = 20
const EXPLICIT_SHOW_ALL_LIMIT = 100

export class SimpleCheckoutAgentRuntime implements AgentRuntime {
  constructor(private readonly deps: {
    planner?: ShoppingPlanner
  } = {}) {}

  async runTurn(args: {
    linkedSubject: LinkedSubject
    session: ConversationSession
    tools: AgentToolDefinition[]
  }): Promise<AgentTurnResult> {
    const latestUserMessage = [...args.session.entries].reverse().find((entry) => entry.role === "user")?.content || ""
    const normalized = latestUserMessage.trim().toLowerCase()
    const marketplaceSession = readMarketplaceSessionState(args.session.metadata)
    const cartResult = findLatestToolOutput(args.session, "cart.get_active")
    const cart = isCartFound(cartResult) ? cartResult : readCartSnapshot(args.session)
    const currentOrderId =
      readString(cart?.orderId) ||
      readString(args.session.metadata?.currentOrderId) ||
      `wa-agent-${Date.now()}`
    const pendingProductOptions = readPendingProductOptions(args.session)
    const pendingMutation = readString(args.session.metadata?.pendingMutation)
    const pendingBrowseType = readString(args.session.metadata?.pendingBrowseType)
    const pendingBundleProductIds = Array.isArray(args.session.metadata?.pendingBundleProductIds)
      ? args.session.metadata?.pendingBundleProductIds as number[]
      : []
    const pendingRecipeTitle = readString(args.session.metadata?.pendingRecipeTitle)
    const pendingRecipeQuery = readString(args.session.metadata?.pendingRecipeQuery)
    const pendingBrowseQuery = readString(args.session.metadata?.pendingBrowseQuery)
    const pendingBrowseCategory = readString(args.session.metadata?.pendingBrowseCategory)
    const pendingBrowsePage = readNumber(args.session.metadata?.pendingBrowsePage) || 0
    const pendingBrowseLimit = readNumber(args.session.metadata?.pendingBrowseLimit) || DEFAULT_BROWSE_LIMIT
    const lastShoppingKind = readString(args.session.metadata?.lastShoppingKind)
    const lastShoppingQuery = readString(args.session.metadata?.lastShoppingQuery)
    const currentMarketplaceOrderId = marketplaceSession.marketplaceOrderId
    const hasPriorAssistantReply = args.session.entries.some((entry) => entry.role === "assistant")
    const plannerDecision = await this.planTurn({
      session: args.session,
      message: latestUserMessage,
      pendingBrowseType,
      pendingRecipeQuery,
      lastShoppingKind,
      lastShoppingQuery,
    })
    const plannerMetadata = summarizePlannerDecision(plannerDecision)
    const plannedBrowseIntent = plannerBrowseIntent(plannerDecision, {
      message: latestUserMessage,
      lastShoppingKind,
      lastShoppingQuery,
    })
    const initialBrowseIntent = parseBrowseIntent(normalized)
      || plannedBrowseIntent
      || parseImplicitBrowseIntent(normalized)
    const selectionInput = plannerDecision?.action === "choose_option" && /^(?:option\s+)?\d+$/.test(normalized)
      ? String(plannerDecision.selectionIndex)
      : normalized

    if (!normalized) {
      return {
        reply: "Sag mir einfach, worauf du Lust hast, zum Beispiel 'Ich moechte Paella machen', 'Zeig mir Getraenke' oder 'Pack Bio-Milch dazu'.",
      }
    }

    if (isGreetingIntent(normalized) && !hasPriorAssistantReply) {
      return {
        reply: buildWelcomeReply(),
      }
    }

    if (/^(help|hilfe|start|\/start|\/help)$/.test(normalized)) {
      return {
        reply: buildWelcomeReply(),
      }
    }

    if (plannerDecision?.action === "clarify" && plannerDecision.reply) {
      return {
        reply: plannerDecision.reply,
        metadata: plannerMetadata,
      }
    }

    if (isCancelIntent(normalized)) {
      return {
        reply: "Alles klar, ich stoppe den aktuellen Auswahl-Flow. Wenn du magst, starten wir direkt mit etwas Neuem, zum Beispiel 'Getraenke', 'Pizza' oder 'Paella fuer 4'.",
        metadata: clearPendingSelectionMetadata(),
      }
    }

    if (isRestartIntent(normalized)) {
      return {
        reply: "Klar, wir starten frisch. Sag mir einfach, worauf du Lust hast oder was du einkaufen moechtest.",
        metadata: clearPendingSelectionMetadata(),
      }
    }

    const entitlementResult = findLatestToolOutput(args.session, "valuya.get_entitlement")
    if (isStatusIntent(normalized)) {
      const paidSubmitResult = findLatestToolOutput(args.session, "alfies.submit_paid_order")
      const orderResult = findLatestToolOutput(args.session, "valuya.create_marketplace_order")
      const marketplaceOrderStatusResult = findLatestToolOutput(args.session, "valuya.get_marketplace_order")
      const marketplaceOrderId = readString(orderResult?.valuyaOrderId) || currentMarketplaceOrderId

      if (!entitlementResult) {
        return {
          toolCalls: [toolCall("valuya.get_entitlement", {
            resource: marketplaceSession.resource,
            plan: marketplaceSession.plan,
          })],
        }
      }

      if (entitlementResult.active === true && paidSubmitResult) {
        const statusDecision = decideMarketplaceStatus({
          snapshot: buildMarketplaceSessionSnapshot({
            entitlementActive: true,
            marketplaceOrderId,
            checkoutUrl: marketplaceSession.checkoutUrl,
            externalOrderId: readString(paidSubmitResult.externalOrderId),
            submittedToMerchant: true,
            marketplaceOrder: marketplaceOrderStatusResult,
          }),
          hasMarketplaceOrderStatus: Boolean(marketplaceOrderStatusResult),
        })
        if (statusDecision.kind === "fetch_order_status") {
          return {
            toolCalls: [toolCall("valuya.get_marketplace_order", {
              orderId: statusDecision.marketplaceOrderId,
            })],
          }
        }
        return {
          reply: buildPaidStatusReply({
            paidSubmitResult,
            marketplaceOrderStatusResult,
          }),
        }
      }

      if (entitlementResult.active === true && marketplaceOrderId) {
        const statusDecision = decideMarketplaceStatus({
          snapshot: buildMarketplaceSessionSnapshot({
            entitlementActive: true,
            marketplaceOrderId,
            checkoutUrl: marketplaceSession.checkoutUrl,
            submittedToMerchant: false,
            marketplaceOrder: marketplaceOrderStatusResult,
          }),
          hasMarketplaceOrderStatus: Boolean(marketplaceOrderStatusResult),
        })
        if (statusDecision.kind === "fetch_order_status") {
          return {
            toolCalls: [toolCall("valuya.get_marketplace_order", {
              orderId: statusDecision.marketplaceOrderId,
            })],
          }
        }
        if (statusDecision.kind === "paid_pending_submission") {
          return {
            reply: buildPaymentConfirmedReply({
              marketplaceOrderStatusResult,
              alfiesSubmitted: false,
            }),
          }
        }
        return {
          reply: "✓ Bezahlt.\nMarketplace-Zahlung bestaetigt.",
        }
      }

      return {
        reply: entitlementResult.active === true
          ? "Zahlung bestaetigt. Guard meldet aktiven Zugriff fuer den Checkout."
          : `Noch kein aktiver Zugriff. Grund: ${readString(entitlementResult.reason) || "inactive"}.`,
      }
    }

    const dispatchResult = findLatestToolOutput(args.session, "alfies.dispatch_order")
    const preparedCheckoutResult = findLatestToolOutput(args.session, "alfies.prepare_checkout")
    const paidSubmitResult = findLatestToolOutput(args.session, "alfies.submit_paid_order")
    const orderResult = findLatestToolOutput(args.session, "valuya.create_marketplace_order")
    const marketplaceOrderStatusResult = findLatestToolOutput(args.session, "valuya.get_marketplace_order")
    const checkoutLinkResult = findLatestToolOutput(args.session, "valuya.create_checkout_link")
    const deliveryContext = readDeliveryContext(args.session)

    if ((isCheckoutIntent(normalized) || isConfirmIntent(normalized)) && !cartResult && hasTool(args.tools, "cart.get_active")) {
      return {
        toolCalls: [toolCall("cart.get_active", {
          whatsappUserId: args.session.whatsappUserId,
        })],
      }
    }

    if ((isCheckoutIntent(normalized) || isConfirmIntent(normalized)) && !cart) {
      return {
        reply: "Ich habe noch keinen aktuellen Warenkorb gefunden. Bitte stelle erst einen Alfies-Warenkorb zusammen.",
      }
    }

    if ((isCheckoutIntent(normalized) || isConfirmIntent(normalized)) && !entitlementResult) {
      return {
        toolCalls: [toolCall("valuya.get_entitlement", {
          resource: marketplaceSession.resource,
          plan: marketplaceSession.plan,
        })],
      }
    }

    if (isCheckoutIntent(normalized) && entitlementResult?.active === true) {
      return {
        reply: "Der Checkout ist bereits aktiv. Du kannst jetzt direkt mit der Bestellung fortfahren.",
      }
    }

    if (isConfirmIntent(normalized) && entitlementResult?.active === true && preparedCheckoutResult && !paidSubmitResult && cart) {
      const shippingOption = readPreparedShippingOption(preparedCheckoutResult)
      const shippingAddress = readPreparedShippingAddress(preparedCheckoutResult)
      const paymentReference = readPreparedPaymentReference(orderResult, checkoutLinkResult)
      const expectedTotalCents = readPreparedCheckoutAmount(preparedCheckoutResult) ?? readNumber(cart.total_cents)
      if (shippingOption && shippingAddress && paymentReference && typeof expectedTotalCents === "number") {
        return {
          toolCalls: [toolCall("alfies.submit_paid_order", {
            localOrderId: currentOrderId,
            paymentReference,
            lines: normalizeLines(cart.items),
            deliveryAddress: shippingAddress,
            shippingOption,
            expectedTotalCents,
          })],
        }
      }
    }

    if (isConfirmIntent(normalized) && paidSubmitResult) {
      if (!marketplaceOrderStatusResult && readString(orderResult?.valuyaOrderId)) {
        return {
          toolCalls: [toolCall("valuya.get_marketplace_order", {
            orderId: readString(orderResult?.valuyaOrderId),
          })],
        }
      }
      return {
        reply: buildPaidStatusReply({
          paidSubmitResult,
          marketplaceOrderStatusResult,
        }),
      }
    }

    if (isConfirmIntent(normalized) && entitlementResult?.active === true && !dispatchResult && cart) {
      return {
        toolCalls: [toolCall("alfies.dispatch_order", {
          localOrderId: currentOrderId,
          lines: normalizeLines(cart.items),
        })],
      }
    }

    if (isConfirmIntent(normalized) && dispatchResult) {
      if (!marketplaceOrderStatusResult && (readString(orderResult?.valuyaOrderId) || currentMarketplaceOrderId)) {
        return {
          toolCalls: [toolCall("valuya.get_marketplace_order", {
            orderId: readString(orderResult?.valuyaOrderId) || currentMarketplaceOrderId,
          })],
        }
      }
      return {
        reply: buildBackendDispatchReply({
          dispatchResult,
          marketplaceOrderStatusResult,
        }),
      }
    }

    if (isCheckoutIntent(normalized) && !preparedCheckoutResult && deliveryContext && cart) {
      return {
        toolCalls: [toolCall("alfies.prepare_checkout", {
          localOrderId: currentOrderId,
          lines: normalizeLines(cart.items),
          deliveryAddress: deliveryContext.deliveryAddress,
          shippingDate: deliveryContext.shippingDate,
          ...(deliveryContext.deliveryNote ? { deliveryNote: deliveryContext.deliveryNote } : {}),
          ...(deliveryContext.phone ? { phone: deliveryContext.phone } : {}),
        })],
        metadata: plannerMetadata,
      }
    }

    if (isCheckoutIntent(normalized) && !orderResult && cart) {
      return {
        toolCalls: [toolCall("valuya.create_marketplace_order", {
          localOrderId: currentOrderId,
          amountCents: readPreparedCheckoutAmount(preparedCheckoutResult) ?? readNumber(cart.total_cents),
          currency: readPreparedCheckoutCurrency(preparedCheckoutResult) || readString(cart.currency) || "EUR",
          asset: "EURe",
          cart: cart.items,
        })],
      }
    }

    if (isCheckoutIntent(normalized) && orderResult && !checkoutLinkResult) {
      return {
        toolCalls: [toolCall("valuya.create_checkout_link", {
          orderId: readString(orderResult.valuyaOrderId),
        })],
      }
    }

    if (isCheckoutIntent(normalized) && checkoutLinkResult) {
      const amount = readPreparedCheckoutAmount(preparedCheckoutResult) ?? readNumber(cart?.total_cents)
      const currency = readPreparedCheckoutCurrency(preparedCheckoutResult) || readString(cart?.currency) || "EUR"
      const itemCount = Array.isArray(cart?.items) ? cart?.items.length : 0
      const checkoutUrl = readString(checkoutLinkResult.checkoutUrl)
      return {
        reply: buildCheckoutPreparedReplyCore({
          ...(typeof amount === "number" ? { amountCents: amount } : {}),
          currency,
          itemCount,
          checkoutUrl,
          language: "de",
        }),
        metadata: withMergedMetadata({
          currentMarketplaceOrderId: readString(orderResult?.valuyaOrderId),
          currentCheckoutUrl: checkoutUrl,
        }, plannerMetadata),
      }
    }

    if (isShowAllCategoriesIntent(normalized)) {
      const result = findLatestToolOutput(args.session, "catalog.browse_categories")
      if (!result) {
        return {
          toolCalls: [toolCall("catalog.browse_categories", {
            query: "",
            limit: EXPLICIT_SHOW_ALL_LIMIT,
          })],
          metadata: plannerMetadata,
        }
      }
      return {
        reply: buildBrowseReply(result),
        metadata: withMergedMetadata({
          pendingProductOptions: Array.isArray(result.options) ? result.options : [],
          pendingProductPrompt: readString(result.prompt) || "Welche Kategorie meinst du?",
          pendingBrowseType: "category",
          pendingBrowseQuery: "",
          pendingBrowseCategory: undefined,
          pendingBrowsePage: 0,
          pendingBrowseLimit: EXPLICIT_SHOW_ALL_LIMIT,
          pendingMutation: undefined,
          pendingQuantity: undefined,
          lastShoppingKind: "category",
          lastShoppingQuery: "",
        }, plannerMetadata),
      }
    }

    if (isAmbiguousQuantityShorthand(normalized)) {
      return {
        reply: "Wenn du eine Menge aendern willst, nenne bitte Produkt und Menge zusammen, zum Beispiel 'setz Pizza auf 4' oder 'Pack 4 Cola dazu'.",
      }
    }

    if (isOneCentIntent(normalized)) {
      const entitlementResult = findLatestToolOutput(args.session, "valuya.get_entitlement")
      if (!entitlementResult) {
        return {
          toolCalls: [toolCall("valuya.get_entitlement", {
            resource: marketplaceSession.resource,
            plan: marketplaceSession.plan,
          })],
        }
      }

      const oneCentCart = buildOneCentCart()
      const existingOrderResult = findLatestToolOutput(args.session, "valuya.create_marketplace_order")
      if (!existingOrderResult) {
        return {
          toolCalls: [toolCall("valuya.create_marketplace_order", {
            localOrderId: `wa-agent-1cent-${Date.now()}`,
            amountCents: 1,
            currency: "EUR",
            asset: "EURe",
            cart: oneCentCart.items,
          })],
        }
      }

      const checkoutLinkResult = findLatestToolOutput(args.session, "valuya.create_checkout_link")
      if (!checkoutLinkResult) {
        return {
          toolCalls: [toolCall("valuya.create_checkout_link", {
            orderId: readString(existingOrderResult?.valuyaOrderId),
          })],
        }
      }

      const checkoutUrl = readString(checkoutLinkResult?.checkoutUrl)
      return {
        reply: [
          "Ich habe einen 1-Cent-Testcheckout vorbereitet.",
          "Testbetrag: 0,01 EUR",
          checkoutUrl ? `Zahlungslink: ${checkoutUrl}` : null,
          "",
          "Nachdem du bezahlt hast, schreibe 'status'.",
        ].filter(Boolean).join("\n"),
        metadata: withMergedMetadata({
          currentMarketplaceOrderId: readString(existingOrderResult?.valuyaOrderId),
          currentCheckoutUrl: checkoutUrl,
        }, clearPlannerMetadata(plannerMetadata)),
      }
    }

    if (!isConfirmIntent(normalized) && pendingBundleProductIds.length && isBundleAcceptIntent(normalized)) {
      const bundleResult = findLatestToolOutput(args.session, "cart.add_bundle")
      if (!bundleResult) {
        return {
          toolCalls: [toolCall("cart.add_bundle", {
            whatsappUserId: args.session.whatsappUserId,
            productIds: pendingBundleProductIds,
          })],
        }
      }
      return {
        reply: [
          buildCartMutationReply(bundleResult),
          pendingRecipeTitle ? `Damit steht die erste Auswahl fuer ${pendingRecipeTitle}.` : null,
          "Wenn du willst, kann ich jetzt noch fehlende Zutaten suchen, Getraenke dazu nehmen oder direkt den Checkout vorbereiten.",
        ].filter(Boolean).join("\n"),
        metadata: clearPendingSelectionMetadata(),
      }
    }

    if (!isConfirmIntent(normalized) && (isBundleAcceptIntent(normalized) || plannerDecision?.action === "accept_bundle") && !pendingBundleProductIds.length) {
      return {
        reply: "Ich habe gerade noch keine konkrete Einkaufsauswahl offen, die ich komplett uebernehmen kann. Sag mir einfach ein Gericht, eine Kategorie oder ein Produkt, dann stelle ich dir etwas zusammen.",
      }
    }

    if (/^(?:option\s+)?\d+$/.test(selectionInput) && !pendingProductOptions.length) {
      return {
        reply: "Ich habe gerade keine offene nummerierte Auswahl. Sag mir einfach noch einmal, was du suchst, dann zeige ich dir passende Optionen.",
      }
    }

    if ((isMoreIntent(normalized) || (isShowAllIntent(normalized) && !initialBrowseIntent)) && !(pendingBrowseQuery || pendingBrowseCategory)) {
      return {
        reply: "Ich habe gerade keine offene Liste zum Weiterblaettern. Sag mir einfach noch einmal, wonach ich schauen soll, dann zeige ich dir passende Optionen.",
      }
    }

    if ((isMoreIntent(normalized) || isShowAllIntent(normalized)) && (pendingBrowseQuery || pendingBrowseCategory)) {
      const nextLimit = isShowAllIntent(normalized) ? EXPLICIT_SHOW_ALL_LIMIT : pendingBrowseLimit
      const nextPage = isShowAllIntent(normalized) ? 0 : pendingBrowsePage + 1
      const requestedQuery = isShowAllIntent(normalized) && plannedBrowseIntent?.kind === "product_query"
        ? plannedBrowseIntent.query
        : pendingBrowseQuery
      const requestedCategory = isShowAllIntent(normalized) && plannedBrowseIntent?.kind === "category_query"
        ? plannedBrowseIntent.query
        : pendingBrowseCategory
      if (pendingBrowseType === "category") {
        const result = findLatestToolOutput(args.session, "catalog.browse_categories")
        if (!result) {
          return {
            toolCalls: [toolCall("catalog.browse_categories", {
              query: requestedQuery,
              page: nextPage,
              limit: nextLimit,
            })],
            metadata: plannerMetadata,
          }
        }
        return {
          reply: buildBrowseReply(result),
          metadata: withMergedMetadata({
            pendingProductOptions: Array.isArray(result.options) ? result.options : [],
            pendingProductPrompt: readString(result.prompt) || "Welche Kategorie meinst du?",
            pendingBrowseType: "category",
            pendingBrowseQuery: requestedQuery,
            pendingBrowseCategory: undefined,
            pendingBrowsePage: nextPage,
            pendingBrowseLimit: nextLimit,
            pendingMutation: undefined,
            pendingQuantity: undefined,
            lastShoppingKind: "category",
            lastShoppingQuery: requestedQuery || "",
          }, plannerMetadata),
        }
      }

      const result = findLatestToolOutput(args.session, "catalog.browse_products")
      if (!result) {
        return {
          toolCalls: [toolCall("catalog.browse_products", {
            query: requestedQuery,
            category: requestedCategory,
            page: nextPage,
            limit: nextLimit,
          })],
          metadata: plannerMetadata,
        }
      }
      return {
        reply: buildBrowseReply(result),
        metadata: withMergedMetadata({
          pendingProductOptions: Array.isArray(result.options) ? result.options : [],
          pendingProductPrompt: readString(result.prompt) || "Welche Produkte meinst du?",
          pendingBrowseType: "product",
          pendingBrowseQuery: requestedQuery,
          pendingBrowseCategory: requestedCategory,
          pendingBrowsePage: nextPage,
          pendingBrowseLimit: nextLimit,
          pendingMutation: "add",
          lastShoppingKind: requestedCategory ? "category" : "product",
          lastShoppingQuery: requestedCategory || requestedQuery || "",
        }, plannerMetadata),
      }
    }

    const recipeIntent = plannerRecipeQuery(plannerDecision) || (looksLikeRecipeMessage(normalized) ? latestUserMessage : null)
    if (recipeIntent && shouldUseGroundedMealFlow(recipeIntent)) {
      const mealCandidates = findLatestToolOutput(args.session, "catalog.meal_candidates")
      if (!mealCandidates) {
        return {
          toolCalls: [toolCall("catalog.meal_candidates", {
            query: recipeIntent,
          })],
          metadata: plannerMetadata,
        }
      }
      if (mealCandidates.found !== false && Array.isArray(mealCandidates.groups) && mealCandidates.groups.length) {
        const mealSuggestion = await this.composeMealSuggestion({
          message: latestUserMessage,
          mealQuery: recipeIntent,
          contextSummary: summarizePlannerContext({
            session: args.session,
            pendingBrowseType,
            pendingRecipeQuery,
            lastShoppingKind,
            lastShoppingQuery,
          }),
          result: mealCandidates,
        })
        if (mealSuggestion) {
          return {
            reply: buildMealSuggestionReply(mealSuggestion),
            metadata: withMergedMetadata({
              pendingProductOptions: mealSuggestion.options,
              pendingProductPrompt: "Welche Zutat oder Variante moechtest du anpassen?",
              pendingBrowseType: "product",
              pendingBrowseQuery: undefined,
              pendingBrowseCategory: undefined,
              pendingBrowsePage: undefined,
              pendingMutation: "add",
              pendingBundleProductIds: mealSuggestion.options
                .map((option) => readNumber(option.productId))
                .filter((value): value is number => typeof value === "number"),
              pendingRecipeTitle: mealSuggestion.title,
              pendingRecipeQuery: recipeIntent,
              lastShoppingKind: "recipe",
              lastShoppingQuery: recipeIntent,
            }, plannerMetadata),
          }
        }
      }
    }

    if (recipeIntent) {
      const result = findLatestToolOutput(args.session, "catalog.recipe_to_products")
      if (!result) {
        return {
          toolCalls: [toolCall("catalog.recipe_to_products", {
            query: recipeIntent,
          })],
          metadata: plannerMetadata,
        }
      }
      if (result.found === false) {
        return {
          reply: "Ich habe noch kein klares Gericht erkannt. Sag mir gern so etwas wie 'Paella fuer 4' oder 'vegetarische Pasta'.",
        }
      }
      return {
        reply: buildRecipeReply(result),
        metadata: withMergedMetadata({
          pendingProductOptions: Array.isArray(result.options) ? result.options : [],
          pendingProductPrompt: "Welche Zutat oder Variante moechtest du anpassen?",
          pendingBrowseType: "product",
          pendingBrowseQuery: undefined,
          pendingBrowseCategory: undefined,
          pendingBrowsePage: undefined,
          pendingMutation: "add",
          pendingBundleProductIds: Array.isArray(result.options)
            ? result.options
              .map((option) => readNumber((option as Record<string, unknown>).productId))
              .filter((value): value is number => typeof value === "number")
            : [],
          pendingRecipeTitle: readString(result.recipeTitle),
          pendingRecipeQuery: recipeIntent,
          lastShoppingKind: "recipe",
          lastShoppingQuery: recipeIntent,
        }, plannerMetadata),
      }
    }

    const refinement = parseRefinementIntent(normalized) || plannerRefinement(plannerDecision)
    if (refinement?.kind === "servings" && pendingRecipeQuery) {
      const result = findLatestToolOutput(args.session, "catalog.recipe_to_products")
      if (!result) {
        return {
          toolCalls: [toolCall("catalog.recipe_to_products", {
            query: `${pendingRecipeQuery} fuer ${refinement.servings}`,
          })],
          metadata: plannerMetadata,
        }
      }
      if (result.found === false) {
        return {
          reply: `Ich habe fuer ${refinement.servings} Personen noch keine gute Variante gefunden. Sag mir gern das Gericht noch einmal etwas genauer.`,
        }
      }
      return {
        reply: buildRecipeReply(result),
        metadata: withMergedMetadata({
          pendingProductOptions: Array.isArray(result.options) ? result.options : [],
          pendingProductPrompt: "Welche Zutat oder Variante moechtest du anpassen?",
          pendingBrowseType: "product",
          pendingBrowseQuery: undefined,
          pendingBrowseCategory: undefined,
          pendingBrowsePage: undefined,
          pendingMutation: "add",
          pendingBundleProductIds: Array.isArray(result.options)
            ? result.options.map((option) => readNumber((option as Record<string, unknown>).productId)).filter((value): value is number => typeof value === "number")
            : [],
          pendingRecipeTitle: readString(result.recipeTitle),
          pendingRecipeQuery: `${pendingRecipeQuery} fuer ${refinement.servings}`,
          lastShoppingKind: "recipe",
          lastShoppingQuery: `${pendingRecipeQuery} fuer ${refinement.servings}`,
        }, plannerMetadata),
      }
    }

    if (refinement?.kind === "modifier" && lastShoppingKind === "recipe" && pendingRecipeQuery) {
      const adjustedQuery = `${pendingRecipeQuery} ${refinement.modifier}`.trim()
      const result = findLatestToolOutput(args.session, "catalog.recipe_to_products")
      if (!result) {
        return {
          toolCalls: [toolCall("catalog.recipe_to_products", {
            query: adjustedQuery,
          })],
          metadata: plannerMetadata,
        }
      }
      if (result.found === false) {
        return {
          reply: `Ich habe fuer ${refinement.label.toLowerCase()} noch keine gute Variante gefunden. Beschreib mir das Gericht gern noch etwas genauer.`,
        }
      }
      return {
        reply: [
          `Alles klar, ich stelle ${readString(result.recipeTitle) || "das Gericht"} ${refinement.replySuffix} zusammen.`,
          "",
          buildRecipeReply(result),
        ].join("\n"),
        metadata: withMergedMetadata({
          pendingProductOptions: Array.isArray(result.options) ? result.options : [],
          pendingProductPrompt: "Welche Zutat oder Variante moechtest du anpassen?",
          pendingBrowseType: "product",
          pendingBrowseQuery: undefined,
          pendingBrowseCategory: undefined,
          pendingBrowsePage: undefined,
          pendingMutation: "add",
          pendingBundleProductIds: Array.isArray(result.options)
            ? result.options.map((option) => readNumber((option as Record<string, unknown>).productId)).filter((value): value is number => typeof value === "number")
            : [],
          pendingRecipeTitle: readString(result.recipeTitle),
          pendingRecipeQuery: adjustedQuery,
          lastShoppingKind: "recipe",
          lastShoppingQuery: adjustedQuery,
        }, plannerMetadata),
      }
    }

    if (refinement?.kind === "modifier" && lastShoppingQuery) {
      const adjustedQuery = `${refinement.modifier} ${lastShoppingQuery}`.trim()
      const result = findLatestToolOutput(args.session, "catalog.browse_products")
      if (!result) {
        return {
          toolCalls: [toolCall("catalog.browse_products", {
            query: adjustedQuery,
            ...(lastShoppingKind === "category" ? { category: lastShoppingQuery } : {}),
          })],
          metadata: plannerMetadata,
        }
      }
      return {
        reply: [
          `Alles klar, ich schaue nach ${refinement.label}.`,
          "",
          buildBrowseReply(result),
        ].join("\n"),
        metadata: withMergedMetadata({
          pendingProductOptions: Array.isArray(result.options) ? result.options : [],
          pendingProductPrompt: readString(result.prompt) || "Welche Produkte meinst du?",
          pendingBrowseType: "product",
          pendingBrowseQuery: adjustedQuery,
          pendingBrowseCategory: lastShoppingKind === "category" ? lastShoppingQuery : undefined,
          pendingBrowsePage: 0,
          pendingBrowseLimit: DEFAULT_BROWSE_LIMIT,
          pendingMutation: "add",
          lastShoppingKind: "product",
          lastShoppingQuery: adjustedQuery,
        }, plannerMetadata),
      }
    }

    const selectedPendingProduct = resolvePendingSelection(selectionInput, pendingProductOptions)
    if (selectedPendingProduct && pendingBrowseType === "category") {
      const result = findLatestToolOutput(args.session, "catalog.browse_products")
      if (!result) {
        return {
          toolCalls: [toolCall("catalog.browse_products", {
            category: selectedPendingProduct.label,
          })],
          metadata: plannerMetadata,
        }
      }
      return {
        reply: buildBrowseReply(result),
        metadata: withMergedMetadata({
          pendingProductOptions: Array.isArray(result.options) ? result.options : [],
          pendingProductPrompt: readString(result.prompt) || "Welche Variante meinst du?",
          pendingBrowseType: "product",
          pendingBrowseQuery: undefined,
          pendingBrowseCategory: selectedPendingProduct.label,
          pendingBrowsePage: 0,
          pendingBrowseLimit: DEFAULT_BROWSE_LIMIT,
          pendingMutation: "add",
        }, plannerMetadata),
      }
    }

    if (selectedPendingProduct && pendingMutation) {
      if (pendingMutation === "add") {
        const result = findLatestToolOutput(args.session, "cart.add_item")
        if (!result) {
          return {
            toolCalls: [toolCall("cart.add_item", {
              whatsappUserId: args.session.whatsappUserId,
              productId: selectedPendingProduct.productId,
              quantity: 1,
            })],
            metadata: plannerMetadata,
          }
        }
        return {
          reply: buildCartMutationReply(result),
          metadata: withMergedMetadata(clearPendingSelectionMetadata(), plannerMetadata),
        }
      }
      if (pendingMutation === "remove") {
        const result = findLatestToolOutput(args.session, "cart.remove_item")
        if (!result) {
          return {
            toolCalls: [toolCall("cart.remove_item", {
              whatsappUserId: args.session.whatsappUserId,
              productId: selectedPendingProduct.productId,
            })],
            metadata: plannerMetadata,
          }
        }
        return {
          reply: buildCartMutationReply(result),
          metadata: withMergedMetadata(clearPendingSelectionMetadata(), plannerMetadata),
        }
      }
      if (pendingMutation === "set") {
        const quantity = readNumber(args.session.metadata?.pendingQuantity) || 1
        const result = findLatestToolOutput(args.session, "cart.set_item_quantity")
        if (!result) {
          return {
            toolCalls: [toolCall("cart.set_item_quantity", {
              whatsappUserId: args.session.whatsappUserId,
              productId: selectedPendingProduct.productId,
              quantity,
            })],
            metadata: plannerMetadata,
          }
        }
        return {
          reply: buildCartMutationReply(result),
          metadata: withMergedMetadata(clearPendingSelectionMetadata(), plannerMetadata),
        }
      }
    }

    const cartMutation = plannerCartMutation(plannerDecision) || parseCartMutation(normalized)
    if (cartMutation) {
      const resolvedProduct = findLatestToolOutput(args.session, "catalog.resolve_product_query")
      if (!resolvedProduct) {
        return {
          toolCalls: [toolCall("catalog.resolve_product_query", {
            query: cartMutation.query,
          })],
          metadata: plannerMetadata,
        }
      }

      if (resolvedProduct.kind === "no_match") {
        return {
          reply: `Ich habe im Alfies-Katalog nichts Passendes fuer '${cartMutation.query}' gefunden.`,
        }
      }

      if (resolvedProduct.kind === "ambiguous") {
        const ambiguousOptions = Array.isArray(resolvedProduct.options)
          ? resolvedProduct.options
          : []
        const allOptionsLackProductIds =
          ambiguousOptions.length > 0 &&
          ambiguousOptions.every((option) => !readNumber((option as Record<string, unknown>).productId))
        const options = Array.isArray(resolvedProduct.options)
          ? resolvedProduct.options.map((option) => readString((option as Record<string, unknown>).title)).filter(Boolean)
          : []
        return {
          reply: options.length
            ? [
                "Ich bin noch nicht sicher, welche Variante du meinst:",
                ...options.map((option, index) => `${index + 1}. ${option}`),
                "",
              "Antworte einfach mit 1, 2, 3 ...",
            ].join("\n")
            : `Ich bin bei '${cartMutation.query}' noch nicht sicher genug. Bitte formuliere es etwas genauer.`,
          metadata: {
            pendingProductOptions: ambiguousOptions.length ? ambiguousOptions : undefined,
            pendingProductPrompt: "Welche Variante meinst du?",
            ...(allOptionsLackProductIds ? { pendingBrowseType: "category" } : {}),
            pendingBrowseQuery: undefined,
            pendingBrowseCategory: undefined,
            pendingBrowsePage: undefined,
            pendingMutation: allOptionsLackProductIds ? undefined : cartMutation.kind,
            ...(cartMutation.kind === "set" ? { pendingQuantity: cartMutation.quantity } : {}),
          },
        }
      }

      const product = resolvedProduct.product as Record<string, unknown> | undefined
      const productId = readNumber(product?.productId)
      if (!productId) {
        return {
          reply: `Ich konnte '${cartMutation.query}' noch nicht sauber zuordnen.`,
        }
      }

      if (cartMutation.kind === "add") {
        const result = findLatestToolOutput(args.session, "cart.add_item")
        if (!result) {
          return {
            toolCalls: [toolCall("cart.add_item", {
              whatsappUserId: args.session.whatsappUserId,
              productId,
              quantity: cartMutation.quantity,
            })],
            metadata: plannerMetadata,
          }
        }
        return {
          reply: buildCartMutationReply(result),
          metadata: clearPendingSelectionMetadata(),
        }
      }

      if (cartMutation.kind === "remove") {
        const result = findLatestToolOutput(args.session, "cart.remove_item")
        if (!result) {
          return {
            toolCalls: [toolCall("cart.remove_item", {
              whatsappUserId: args.session.whatsappUserId,
              productId,
            })],
            metadata: plannerMetadata,
          }
        }
        return {
          reply: buildCartMutationReply(result),
          metadata: clearPendingSelectionMetadata(),
        }
      }

      if (cartMutation.kind === "set") {
        const result = findLatestToolOutput(args.session, "cart.set_item_quantity")
        if (!result) {
          return {
            toolCalls: [toolCall("cart.set_item_quantity", {
              whatsappUserId: args.session.whatsappUserId,
              productId,
              quantity: cartMutation.quantity,
            })],
            metadata: plannerMetadata,
          }
        }
        return {
          reply: buildCartMutationReply(result),
          metadata: clearPendingSelectionMetadata(),
        }
      }
    }

    const browseIntent = initialBrowseIntent
    if (browseIntent?.kind === "category_query") {
      const browseLimit = isShowAllIntent(normalized) ? EXPLICIT_SHOW_ALL_LIMIT : DEFAULT_BROWSE_LIMIT
      const result = findLatestToolOutput(args.session, "catalog.browse_categories")
      if (!result) {
        return {
          toolCalls: [toolCall("catalog.browse_categories", {
            query: browseIntent.query,
            limit: browseLimit,
          })],
          metadata: plannerMetadata,
        }
      }
      return {
        reply: buildBrowseReply(result),
        metadata: withMergedMetadata({
          pendingProductOptions: Array.isArray(result.options) ? result.options : [],
          pendingProductPrompt: readString(result.prompt) || "Welche Kategorie meinst du?",
          pendingBrowseType: "category",
          pendingBrowseQuery: browseIntent.query,
          pendingBrowseCategory: undefined,
          pendingBrowsePage: 0,
          pendingBrowseLimit: browseLimit,
          pendingMutation: undefined,
          pendingQuantity: undefined,
          lastShoppingKind: "category",
          lastShoppingQuery: browseIntent.query,
        }, plannerMetadata),
      }
    }

    if (browseIntent?.kind === "product_query") {
      const browseLimit = isShowAllIntent(normalized) ? EXPLICIT_SHOW_ALL_LIMIT : DEFAULT_BROWSE_LIMIT
      const result = findLatestToolOutput(args.session, "catalog.browse_products")
      if (!result) {
        return {
          toolCalls: [toolCall("catalog.browse_products", {
            query: browseIntent.query,
            limit: browseLimit,
          })],
          metadata: plannerMetadata,
        }
      }
      return {
        reply: buildBrowseReply(result),
        metadata: withMergedMetadata({
          pendingProductOptions: Array.isArray(result.options) ? result.options : [],
          pendingProductPrompt: readString(result.prompt) || "Welche Produkte meinst du?",
          pendingBrowseType: "product",
          pendingBrowseQuery: browseIntent.query,
          pendingBrowseCategory: undefined,
          pendingBrowsePage: 0,
          pendingBrowseLimit: browseLimit,
          pendingMutation: "add",
          lastShoppingKind: "product",
          lastShoppingQuery: browseIntent.query,
        }, plannerMetadata),
      }
    }

    return {
      reply: [
        "Ich kann dir gerade beim Einkaufen und Checkout helfen.",
        "Sag zum Beispiel 'Ich moechte Paella machen', 'Zeig mir Getraenke', 'Pack Bio-Milch dazu' oder 'checkout'.",
      ].join(" "),
    }
  }

  private async planTurn(args: {
    session: ConversationSession
    message: string
    pendingBrowseType?: string
    pendingRecipeQuery?: string
    lastShoppingKind?: string
    lastShoppingQuery?: string
  }): Promise<ShoppingPlannerDecision | null> {
    if (!this.deps.planner) return null
    const contextSummary = summarizePlannerContext(args)
    try {
      const result = await this.deps.planner.plan({
        message: args.message,
        contextSummary,
      })
      return validatePlannerDecision({
        decision: result,
        message: args.message,
        pendingRecipeQuery: args.pendingRecipeQuery,
        lastShoppingKind: args.lastShoppingKind,
        lastShoppingQuery: args.lastShoppingQuery,
      })
    } catch {
      return null
    }
  }

  private async composeMealSuggestion(args: {
    message: string
    mealQuery: string
    contextSummary: string
    result: Record<string, unknown>
  }): Promise<{
    title: string
    intro?: string
    followUpQuestion?: string
    unresolvedIngredients: string[]
    options: Array<Record<string, unknown>>
  } | null> {
    const groups = readMealCandidateGroups(args.result)
    if (!groups.length) return null

    const plannerComposition = await this.deps.planner?.composeMeal?.({
      message: args.message,
      mealQuery: args.mealQuery,
      contextSummary: args.contextSummary,
      candidates: groups.map((group) => ({
        ingredient: group.ingredient,
        options: group.options
          .map((option) => ({
            productId: readNumber(option.productId) || 0,
            label: readString(option.label) || readString(option.value) || "",
            unitPriceCents: readNumber(option.unitPriceCents ?? option.unit_price_cents),
            currency: readString(option.currency),
          }))
          .filter((option) => option.productId > 0 && option.label),
      })),
    }).catch(() => null)

    const optionMap = new Map<number, Record<string, unknown>>()
    for (const group of groups) {
      for (const option of group.options) {
        const productId = readNumber(option.productId)
        if (!productId || optionMap.has(productId)) continue
        optionMap.set(productId, option)
      }
    }

    const selectedOptions = plannerComposition?.selectedProductIds
      ?.map((productId) => optionMap.get(productId))
      .filter((option): option is Record<string, unknown> => Boolean(option))
      || []

    const fallbackOptions = groups
      .map((group) => group.options[0])
      .filter((option): option is Record<string, unknown> => Boolean(option))
      .slice(0, 4)

    const options = selectedOptions.length ? selectedOptions : fallbackOptions
    if (!options.length) return null

    const unresolvedIngredients = plannerComposition?.unresolvedIngredients
      || readStringArray(args.result.unresolvedIngredients)

    return {
      title: plannerComposition?.title || readString(args.result.mealTitle) || titleCaseLoose(args.mealQuery),
      ...(plannerComposition?.intro ? { intro: plannerComposition.intro } : {}),
      ...(plannerComposition?.followUpQuestion ? { followUpQuestion: plannerComposition.followUpQuestion } : {}),
      unresolvedIngredients,
      options,
    }
  }
}

function toolCall(name: string, input: Record<string, unknown>): AgentToolCall {
  return {
    id: `${name}:${Date.now()}`,
    name,
    input,
  }
}

function isStatusIntent(value: string): boolean {
  return /^(status|payment status|pay status|zahlung status)$/.test(value)
}

function isGreetingIntent(value: string): boolean {
  return /^(hi|hallo|hey|hello|guten morgen|guten abend|moin)$/.test(value)
}

function isCheckoutIntent(value: string): boolean {
  return /^(checkout|pay|zahlung|bezahlen|order|bestellen)$/.test(value)
}

function isOneCentIntent(value: string): boolean {
  return /^(?:\/)?(?:1cent|test1cent)$/.test(value)
}

function isConfirmIntent(value: string): boolean {
  return /^(confirm|bestaetigen|bestellung bestaetigen|jetzt bestaetigen)$/.test(value)
}

function isCancelIntent(value: string): boolean {
  return /^(cancel|abbrechen|stopp|stop)$/.test(value)
}

function isRestartIntent(value: string): boolean {
  return /^(neu|neustart|restart|von vorne|nochmal neu)$/.test(value)
}

function isAmbiguousQuantityShorthand(value: string): boolean {
  return /^\d+\s*x\s*\d+$/.test(value)
}

function isMoreIntent(value: string): boolean {
  const normalized = normalizeLoose(value).replace(/\s*-\s*/g, " ").replace(/\s+/g, " ").trim()
  return /^(mehr|mehr bitte|noch mehr|gibts noch mehr|gibt es noch mehr|mehr davon|weitere|weitere bitte|zeig(?:e)? mir mehr|zeige(?:\s+mir)? mehr|kannst du mir alle zeigen|kannst du sie mir alle zeigen|sind das alle|sind das alle oder gibt es noch mehr|sind das alle oder gibts noch mehr|gibt es da noch mehr|gibts da noch mehr)$/.test(normalized)
}

function isShowAllIntent(value: string): boolean {
  const normalized = normalizeLoose(value).replace(/\s*-\s*/g, " ").replace(/\s+/g, " ").trim()
  return /^(alle zeigen|zeig(?:e|st)?(?:\s+du)?(?:\s+mir)?(?:\s+bitte)?\s+alle(?:\s+.+)?|kannst du mir alle(?:\s+.+)? zeigen|kannst du sie mir alle zeigen)$/.test(normalized)
}

function isShowAllCategoriesIntent(value: string): boolean {
  const normalized = normalizeLoose(value)
  return /^(zeige|zeig)(?:\s+du)?(?:\s+mir)?(?:\s+bitte)?\s+alle\s+kategorien$/.test(normalized)
}

function isBundleAcceptIntent(value: string): boolean {
  const normalized = normalizeLoose(value)
  return /^(alles|passt|ja|ja bitte|gern|gerne|bitte|in den warenkorb|nimm alles)$/.test(normalized)
}

function validatePlannerDecision(args: {
  decision: ShoppingPlannerDecision | null
  message: string
  pendingRecipeQuery?: string
  lastShoppingKind?: string
  lastShoppingQuery?: string
}): ShoppingPlannerDecision | null {
  const decision = args.decision
  if (!decision || decision.confidence < 0.55) return null

  const normalizedMessage = normalizeLoose(args.message)

  if (decision.action === "refine_recipe" && !args.pendingRecipeQuery && args.lastShoppingKind !== "recipe") {
    return null
  }

  if (decision.action === "recipe") {
    const query = normalizeLoose(decision.query)
    if (!query) return null
    if (normalizedMessage.includes(query)) return decision
    if (args.pendingRecipeQuery && normalizeLoose(args.pendingRecipeQuery).includes(query)) return decision
    if (args.lastShoppingKind === "recipe" && args.lastShoppingQuery && normalizeLoose(args.lastShoppingQuery).includes(query)) return decision
    return null
  }

  if ((decision.action === "browse_products" || decision.action === "browse_categories") && !readString(decision.query) && !isMoreIntent(normalizedMessage)) {
    if (decision.action === "browse_categories" && /\b(einkauf|einkaufen|kategorien?|sortiment|auswahl)\b/.test(normalizedMessage)) {
      return decision
    }
    return null
  }

  if (decision.action === "unknown" && (isCancelIntent(normalizedMessage) || isRestartIntent(normalizedMessage))) {
    return null
  }

  if (
    (decision.action === "add_item" || decision.action === "remove_item" || decision.action === "set_item_quantity")
    && !looksLikeExplicitCartMutationMessage(normalizedMessage)
  ) {
    return null
  }

  return decision
}

function summarizePlannerContext(args: {
  session: ConversationSession
  pendingBrowseType?: string
  pendingRecipeQuery?: string
  lastShoppingKind?: string
  lastShoppingQuery?: string
}): string {
  const metadata = args.session.metadata || {}
  const cartSnapshot =
    metadata.currentCartSnapshot && typeof metadata.currentCartSnapshot === "object"
      ? metadata.currentCartSnapshot as Record<string, unknown>
      : null
  const cartItemCount = Array.isArray(cartSnapshot?.items) ? cartSnapshot.items.length : 0
  const pendingOptionsCount = Array.isArray(metadata.pendingProductOptions) ? metadata.pendingProductOptions.length : 0
  const recentTurns = args.session.entries
    .filter((entry) => entry.role === "user" || entry.role === "assistant")
    .slice(-5)
    .map((entry, index) => `${index + 1}. ${entry.role}: ${entry.content}`)

  return [
    "state:",
    `- pending_browse_type: ${args.pendingBrowseType || "none"}`,
    `- pending_recipe_query: ${args.pendingRecipeQuery || "none"}`,
    `- last_shopping_kind: ${args.lastShoppingKind || "none"}`,
    `- last_shopping_query: ${args.lastShoppingQuery || "none"}`,
    `- pending_options_count: ${pendingOptionsCount}`,
    `- cart_item_count: ${cartItemCount}`,
    `- current_order_id: ${readString(metadata.currentOrderId) || "none"}`,
    "recent_turns:",
    ...(recentTurns.length ? recentTurns : ["- none"]),
  ].join("\n")
}

function readCartSnapshot(session: ConversationSession): Record<string, unknown> | null {
  const value = session.metadata?.currentCartSnapshot
  return value && typeof value === "object" ? value as Record<string, unknown> : null
}

function looksLikeExplicitCartMutationMessage(value: string): boolean {
  return /^(?:add|plus|remove|delete|pack(?:e)?|nimm|fueg(?:e)?|füg(?:e)?|ohne|entferne|loesch(?:e)?|lösche|setze|mach)\b/.test(value)
}

function findLatestToolOutput(session: ConversationSession, toolName: string): Record<string, unknown> | null {
  const lastUserIndex = [...session.entries].map((entry) => entry.role).lastIndexOf("user")
  const entries = lastUserIndex >= 0 ? session.entries.slice(lastUserIndex + 1) : session.entries
  for (const entry of [...entries].reverse()) {
    if (entry.role !== "tool" || entry.name !== toolName) continue
    try {
      const parsed = JSON.parse(entry.content)
      return parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : null
    } catch {
      return null
    }
  }
  return null
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined
}

function readNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return Math.trunc(value)
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return Math.trunc(parsed)
  }
  return undefined
}

function formatAmount(cents: number, currency: string): string {
  return new Intl.NumberFormat("de-DE", {
    style: "currency",
    currency: currency || "EUR",
  }).format(cents / 100)
}

function hasTool(tools: AgentToolDefinition[], name: string): boolean {
  return tools.some((tool) => tool.name === name)
}

function isCartFound(value: Record<string, unknown> | null): boolean {
  return Boolean(value && value.found !== false && Array.isArray(value.items))
}

function normalizeLines(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) return []
  return value
    .filter((line) => Boolean(line) && typeof line === "object")
    .map((line) => {
      const record = line as Record<string, unknown>
      return {
        sku: record.sku,
        name: record.name,
        qty: record.qty,
        unit_price_cents: record.unit_price_cents ?? record.unitPriceCents,
      }
    })
}

function parseCartMutation(value: string):
  | { kind: "add"; query: string; quantity: number }
  | { kind: "remove"; query: string }
  | { kind: "set"; query: string; quantity: number }
  | null {
  const addGermanLeadingQuantityMatch =
    /^(?:pack(?:e)?|nimm|fueg(?:e)?(?:\s+bitte)?|füg(?:e)?(?:\s+bitte)?)(?:\s+noch)?\s+(\d+)\s+(.+?)(?:\s+(?:dazu|in den warenkorb|hinzu))?$/.exec(value)
  if (addGermanLeadingQuantityMatch) {
    return {
      kind: "add",
      query: addGermanLeadingQuantityMatch[2]!.trim(),
      quantity: Math.max(1, Math.trunc(Number(addGermanLeadingQuantityMatch[1]))),
    }
  }

  const addMatch = /^(?:add|plus)\s+(.+?)(?:\s+(\d+))?$/.exec(value)
  if (addMatch) {
    return {
      kind: "add",
      query: addMatch[1]!.trim(),
      quantity: addMatch[2] ? Math.max(1, Math.trunc(Number(addMatch[2]))) : 1,
    }
  }

  const addGermanMatch =
    /^(?:pack(?:e)?|nimm|fueg(?:e)?(?:\s+bitte)?|füg(?:e)?(?:\s+bitte)?)(?:\s+noch)?\s+(.+?)(?:\s+(?:dazu|in den warenkorb|hinzu))?(?:\s+(\d+))?$/.exec(value)
  if (addGermanMatch) {
    return {
      kind: "add",
      query: addGermanMatch[1]!.trim(),
      quantity: addGermanMatch[2] ? Math.max(1, Math.trunc(Number(addGermanMatch[2]))) : 1,
    }
  }

  const removeMatch = /^(?:remove|delete)\s+(.+)$/.exec(value)
  if (removeMatch) {
    return {
      kind: "remove",
      query: removeMatch[1]!.trim(),
    }
  }

  const removeGermanMatch =
    /^(?:ohne|nimm)\s+(.+?)(?:\s+raus|bitte raus|entfernen)?$/.exec(value) ||
    /^(?:entferne|loesch(?:e)?|lösche)\s+(.+)$/.exec(value)
  if (removeGermanMatch) {
    return {
      kind: "remove",
      query: removeGermanMatch[1]!.trim(),
    }
  }

  const setMatch = /^(?:set|update)\s+(.+?)\s+(\d+)$/.exec(value)
  if (setMatch) {
    return {
      kind: "set",
      query: setMatch[1]!.trim(),
      quantity: Math.max(1, Math.trunc(Number(setMatch[2]))),
    }
  }

  const setGermanMatch =
    /^(?:setze|mach)\s+(.+?)\s+(?:auf|zu)\s+(\d+)$/.exec(value)
  if (setGermanMatch) {
    return {
      kind: "set",
      query: setGermanMatch[1]!.trim(),
      quantity: Math.max(1, Math.trunc(Number(setGermanMatch[2]))),
    }
  }
  return null
}

function buildCartMutationReply(result: Record<string, unknown>): string {
  const message = readString(result.message) || "Warenkorb aktualisiert."
  const cart = result.cart && typeof result.cart === "object" ? result.cart as Record<string, unknown> : null
  const total = readNumber(cart?.total_cents)
  const currency = readString(cart?.currency) || "EUR"
  const itemCount = Array.isArray(cart?.items) ? cart.items.length : 0
  return [
    message,
    itemCount ? `Positionen im Warenkorb: ${itemCount}` : null,
    typeof total === "number" ? `Gesamt: ${formatAmount(total, currency)}` : null,
    itemCount ? "Wenn du magst, suche ich dir jetzt noch passende Extras oder bereite direkt den Checkout vor." : null,
  ].filter(Boolean).join("\n")
}

function readPendingProductOptions(session: ConversationSession): Array<Record<string, unknown>> {
  const value = session.metadata?.pendingProductOptions
  return Array.isArray(value)
    ? value.filter((option): option is Record<string, unknown> => Boolean(option) && typeof option === "object")
    : []
}

function readDeliveryContext(session: ConversationSession): {
  deliveryAddress: {
    line1: string
    house: string
    postcode: string
    city: string
    latitude: number
    longitude: number
    phone?: string
    notes?: string
  }
  shippingDate: string
  deliveryNote?: string
  phone?: string
} | null {
  const metadata = session.metadata || {}
  const marketplaceSession = readMarketplaceSessionState(metadata)
  const shippingDate = marketplaceSession.shippingDate
  const value = marketplaceSession.deliveryAddress
  if (!shippingDate || !value || typeof value !== "object") return null
  const record = value as Record<string, unknown>
  const line1 = readString(record.line1)
  const house = readString(record.house)
  const postcode = readString(record.postcode)
  const city = readString(record.city)
  const latitude = readNumber(record.latitude)
  const longitude = readNumber(record.longitude)
  if (!line1 || !house || !postcode || !city || typeof latitude !== "number" || typeof longitude !== "number") {
    return null
  }
  const phone = readString(record.phone) || marketplaceSession.phone
  const notes = readString(record.notes) || marketplaceSession.deliveryNote
  return {
    deliveryAddress: {
      line1,
      house,
      postcode,
      city,
      latitude,
      longitude,
      ...(phone ? { phone } : {}),
      ...(notes ? { notes } : {}),
    },
    shippingDate,
    ...(notes ? { deliveryNote: notes } : {}),
    ...(phone ? { phone } : {}),
  }
}

function readPreparedCheckoutAmount(result: Record<string, unknown> | null): number | undefined {
  return readNumber(result?.basketTotalCents ?? result?.basket_total_cents)
}

function readPreparedCheckoutCurrency(result: Record<string, unknown> | null): string | undefined {
  return readString(result?.currency)
}

function readPreparedShippingAddress(result: Record<string, unknown> | null):
  | {
      line1: string
      house: string
      postcode: string
      city: string
      latitude: number
      longitude: number
      phone?: string
      notes?: string
    }
  | undefined {
  const value = result?.shippingAddress ?? result?.shipping_address
  if (!value || typeof value !== "object") return undefined
  const record = value as Record<string, unknown>
  const line1 = readString(record.line1)
  const house = readString(record.house)
  const postcode = readString(record.postcode)
  const city = readString(record.city)
  const latitude = readNumber(record.latitude)
  const longitude = readNumber(record.longitude)
  if (!line1 || !house || !postcode || !city || typeof latitude !== "number" || typeof longitude !== "number") {
    return undefined
  }
  return {
    line1,
    house,
    postcode,
    city,
    latitude,
    longitude,
    ...(readString(record.phone) ? { phone: readString(record.phone) } : {}),
    ...(readString(record.notes) ? { notes: readString(record.notes) } : {}),
  }
}

function readPreparedShippingOption(result: Record<string, unknown> | null):
  | { code: string; date?: string; name?: string; shippingChargeCents?: number; currency?: string; raw?: Record<string, unknown> }
  | undefined {
  const value = result?.suggestedShippingOption ?? result?.suggested_shipping_option
  if (!value || typeof value !== "object") return undefined
  const record = value as Record<string, unknown>
  const code = readString(record.code)
  if (!code) return undefined
  return {
    code,
    ...(readString(record.date) ? { date: readString(record.date) } : {}),
    ...(readString(record.name) ? { name: readString(record.name) } : {}),
    ...(typeof readNumber(record.shippingChargeCents ?? record.shipping_charge_cents) === "number"
      ? { shippingChargeCents: readNumber(record.shippingChargeCents ?? record.shipping_charge_cents) }
      : {}),
    ...(readString(record.currency) ? { currency: readString(record.currency) } : {}),
    raw: record,
  }
}

function readPreparedPaymentReference(
  orderResult: Record<string, unknown> | null,
  checkoutLinkResult: Record<string, unknown> | null,
): string | undefined {
  return readString(orderResult?.valuyaOrderId)
    || readString(orderResult?.order_id)
    || readString(checkoutLinkResult?.orderId)
    || readString(checkoutLinkResult?.checkoutToken)
}

function buildPaidStatusReply(args: {
  paidSubmitResult: Record<string, unknown>
  marketplaceOrderStatusResult: Record<string, unknown> | null
}): string {
  const tx = readMarketplaceTransaction(args.marketplaceOrderStatusResult)
  return [
    "✓ Bezahlt.",
    "Bestellung wurde an Alfies uebergeben.",
    readString(args.paidSubmitResult.externalOrderId)
      ? `Alfies Bestellnummer: ${readString(args.paidSubmitResult.externalOrderId)}`
      : null,
    ...buildTransactionLines(tx),
    "E-Mail/CSV Versand wurde ausgeloest.",
  ].filter(Boolean).join("\n")
}

function buildPaymentConfirmedReply(args: {
  marketplaceOrderStatusResult: Record<string, unknown> | null
  alfiesSubmitted: boolean
}): string {
  const reply = buildPaymentConfirmedReplyCore({
    transaction: readMarketplaceTransaction(args.marketplaceOrderStatusResult),
    submittedToMerchant: args.alfiesSubmitted,
    language: "de",
  })
  return args.alfiesSubmitted
    ? reply
    : `${reply}\nWenn du die Bestellung jetzt an Alfies uebergeben willst, schreib 'confirm'.`
}

function buildBackendDispatchReply(args: {
  dispatchResult: Record<string, unknown>
  marketplaceOrderStatusResult: Record<string, unknown> | null
}): string {
  const tx = readMarketplaceTransaction(args.marketplaceOrderStatusResult)
  return [
    "✓ Bezahlt.",
    "Die Bestellung wurde an das Alfies-Backend uebergeben.",
    readString(args.dispatchResult.externalOrderId)
      ? `Externe Bestellnummer: ${readString(args.dispatchResult.externalOrderId)}`
      : null,
    ...buildTransactionLines(tx),
    "E-Mail/CSV Versand wurde ausgeloest.",
  ].filter(Boolean).join("\n")
}

function buildTransactionLines(tx:
  | { txHash?: string; chainId?: number }
  | null,
): string[] {
  return buildTransactionLinesCore({
    transaction: tx,
    language: "de",
  })
}

function readMarketplaceTransaction(result: Record<string, unknown> | null):
  | { txHash?: string; chainId?: number }
  | null {
  return readMarketplaceTransactionCore(result)
}

function resolvePendingSelection(
  normalized: string,
  options: Array<Record<string, unknown>>,
): { productId?: number; label?: string } | null {
  const numeric = /^(?:option\s+)?(\d+)$/.exec(normalized)
  if (!numeric) return null
  const index = Math.trunc(Number(numeric[1])) - 1
  if (index < 0 || index >= options.length) return null
  const productId = readNumber(options[index]?.productId)
  const label = readString(options[index]?.label) || readString(options[index]?.value)
  if (!productId && !label) return null
  return { ...(productId ? { productId } : {}), ...(label ? { label } : {}) }
}

function clearPendingSelectionMetadata(): Record<string, unknown> {
  return {
    pendingProductOptions: [],
    pendingProductPrompt: undefined,
    pendingBrowseType: undefined,
    pendingMutation: undefined,
    pendingQuantity: undefined,
    pendingBundleProductIds: undefined,
    pendingRecipeTitle: undefined,
    pendingRecipeQuery: undefined,
    pendingBrowseQuery: undefined,
    pendingBrowseCategory: undefined,
    pendingBrowsePage: undefined,
    pendingBrowseLimit: undefined,
  }
}

function withMergedMetadata(
  metadata: Record<string, unknown> | undefined,
  extra: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!metadata && !extra) return undefined
  return {
    ...(metadata || {}),
    ...(extra || {}),
  }
}

function clearPlannerMetadata(metadata: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!metadata) return undefined
  const result = { ...(metadata || {}) }
  delete result.plannerAction
  delete result.plannerConfidence
  delete result.plannerQuery
  delete result.plannerCategory
  delete result.plannerQuantity
  delete result.plannerModifier
  delete result.plannerServings
  delete result.plannerSelectionIndex
  delete result.plannerReply
  return Object.keys(result).length ? result : undefined
}

function plannerBrowseIntent(
  decision: ShoppingPlannerDecision | null,
  context?: {
    message?: string
    lastShoppingKind?: string
    lastShoppingQuery?: string
  },
):
  | { kind: "category_query"; query: string }
  | { kind: "product_query"; query: string }
  | null {
  if (!decision) return null
  if (decision.action === "browse_categories") {
    const taxonomyKind = resolveShopperBrowseTaxonomy(decision.query || decision.category || "")
    if (readString(decision.query)) {
      const query = canonicalizeBrowseQuery(readString(decision.query) || "")
      if (taxonomyKind?.kind === "product") {
        return { kind: "product_query", query }
      }
      if (isBroadFamilyBrowseQuery(query)) {
        return { kind: "product_query", query }
      }
      return { kind: "category_query", query }
    }
    return { kind: "category_query", query: "" }
  }
  if (decision.action === "browse_products") {
    const taxonomyKind = resolveShopperBrowseTaxonomy(decision.query || decision.category || "")
    const rawQuery = canonicalizeBrowseQuery(decision.query || decision.category || "")
    const mergedQuery = mergeContinuationBrowseQuery(rawQuery, context)
    if (taxonomyKind?.kind === "category") {
      return {
        kind: "category_query",
        query: mergedQuery,
      }
    }
    return {
      kind: "product_query",
      query: mergedQuery,
    }
  }
  return null
}

function mergeContinuationBrowseQuery(
  query: string,
  context?: {
    message?: string
    lastShoppingKind?: string
    lastShoppingQuery?: string
  },
): string {
  const normalizedQuery = canonicalizeBrowseQuery(query)
  const message = normalizeLoose(context?.message || "")
  const lastQuery = canonicalizeBrowseQuery(context?.lastShoppingQuery || "")
  if (!normalizedQuery || !lastQuery) return normalizedQuery
  if (context?.lastShoppingKind !== "product" && context?.lastShoppingKind !== "category") return normalizedQuery
  if (!/\b(mehr|weitere|alle|noch)\b/.test(message)) return normalizedQuery
  if (normalizedQuery.includes(lastQuery) || lastQuery.includes(normalizedQuery)) return normalizedQuery
  if (!looksLikeBrandQuery(normalizedQuery)) return normalizedQuery
  return `${normalizedQuery} ${lastQuery}`.trim()
}

function plannerRecipeQuery(decision: ShoppingPlannerDecision | null): string | null {
  if (!decision || decision.action !== "recipe") return null
  return decision.query.trim() || null
}

function plannerRefinement(decision: ShoppingPlannerDecision | null):
  | { kind: "servings"; servings: number }
  | { kind: "modifier"; modifier: string; label: string; replySuffix: string }
  | null {
  if (!decision) return null
  if (decision.action === "refine_recipe" || decision.action === "refine_browse") {
    if (typeof decision.servings === "number" && decision.servings > 0) {
      return { kind: "servings", servings: decision.servings }
    }
    if (decision.modifier) {
      return mapPlannerModifier(decision.modifier)
    }
  }
  return null
}

function plannerCartMutation(decision: ShoppingPlannerDecision | null):
  | { kind: "add"; query: string; quantity: number }
  | { kind: "remove"; query: string }
  | { kind: "set"; query: string; quantity: number }
  | null {
  if (!decision) return null
  if (decision.action === "add_item") {
    if (!readString(decision.query)) return null
    return {
      kind: "add",
      query: decision.query,
      quantity: Math.max(1, decision.quantity || 1),
    }
  }
  if (decision.action === "remove_item") {
    if (!readString(decision.query)) return null
    return {
      kind: "remove",
      query: decision.query,
    }
  }
  if (decision.action === "set_item_quantity") {
    if (!readString(decision.query)) return null
    return {
      kind: "set",
      query: decision.query,
      quantity: Math.max(1, decision.quantity || 1),
    }
  }
  return null
}

function mapPlannerModifier(modifier: string):
  | { kind: "modifier"; modifier: string; label: string; replySuffix: string }
  | null {
  const value = modifier.trim().toLowerCase()
  if (!value) return null
  if (value.includes("alkohol")) {
    return { kind: "modifier", modifier: "alkoholfrei", label: "alkoholfreien Optionen", replySuffix: "alkoholfrei" }
  }
  if (value.includes("bio")) {
    return { kind: "modifier", modifier: "bio", label: "Bio-Optionen", replySuffix: "mit Bio-Fokus" }
  }
  if (value.includes("vegetar")) {
    return { kind: "modifier", modifier: "vegetarisch", label: "vegetarischen Optionen", replySuffix: "vegetarisch" }
  }
  if (value.includes("vegan")) {
    return { kind: "modifier", modifier: "vegan", label: "veganen Optionen", replySuffix: "vegan" }
  }
  if (value.includes("meer")) {
    return { kind: "modifier", modifier: "mit meeresfruechten", label: "Varianten mit Meeresfruechten", replySuffix: "mit Meeresfruechten" }
  }
  if (value.includes("regional")) {
    return { kind: "modifier", modifier: "regional", label: "regionalen Optionen", replySuffix: "mit regionalem Fokus" }
  }
  if (value.includes("guenstig") || value.includes("günstig") || value.includes("billig")) {
    return { kind: "modifier", modifier: "guenstig", label: "guenstigeren Optionen", replySuffix: "etwas guenstiger" }
  }
  return { kind: "modifier", modifier: value, label: `${value}en Optionen`, replySuffix: value }
}

function normalizeLoose(value: string): string {
  return String(value || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\w\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

function canonicalizeBrowseQuery(value: string): string {
  const normalized = normalizeLoose(value)
  if (!normalized) return ""
  const taxonomy = resolveShopperBrowseTaxonomy(normalized)
  if (taxonomy) return taxonomy.query
  if (/\bpizzasorten?\b/.test(normalized)) return "pizza"
  if (/\bbiersorten?\b/.test(normalized)) return "bier"
  if (/\bweinsorten?\b/.test(normalized)) return "wein"
  if (/\bsoftdrinks?\b/.test(normalized)) return "getraenke"
  if (/\bsaefte?\b/.test(normalized)) return "saft"
  return normalized
}

type ShopperBrowseTaxonomy = {
  kind: "product" | "category"
  query: string
  aliases: string[]
}

const SHOPPER_BROWSE_TAXONOMY: ShopperBrowseTaxonomy[] = [
  { kind: "product", query: "getraenke", aliases: ["getranke", "getranke", "getranke", "getraenke", "getränke", "drinks", "was zu trinken", "trinken"] },
  { kind: "product", query: "wasser", aliases: ["wasser", "mineralwasser", "soda", "sprudel", "stilles wasser", "stilles", "aromatisiertes wasser"] },
  { kind: "product", query: "saft", aliases: ["saft", "safte", "säfte", "fruchtsaft", "smoothie", "smoothies", "gemuesesaft", "gemüsesaft", "mehrfruchtsaft"] },
  { kind: "product", query: "cola", aliases: ["cola", "cola mix", "colamix", "spezi"] },
  { kind: "product", query: "eistee", aliases: ["eistee", "ice tea"] },
  { kind: "product", query: "energydrink", aliases: ["energy", "energydrink", "energydrinks", "energy drink"] },
  { kind: "product", query: "mate", aliases: ["mate"] },
  { kind: "product", query: "bier", aliases: ["bier", "biere", "biersorten", "bier sorten", "craft bier", "helles", "maerzen", "märzen", "pils", "radler", "weissbier", "weißbier", "zwickl", "kellerbier"] },
  { kind: "product", query: "wein", aliases: ["wein", "weine", "weinsorten", "weisswein", "weißwein", "rotwein", "rose", "rosewein", "roseweine", "schaumwein"] },
  { kind: "product", query: "sekt", aliases: ["sekt", "prosecco", "spumante", "frizzante"] },
  { kind: "product", query: "champagner", aliases: ["champagner", "champagne"] },
  { kind: "product", query: "cider", aliases: ["cider", "cidre"] },
  { kind: "product", query: "gin", aliases: ["gin"] },
  { kind: "product", query: "rum", aliases: ["rum"] },
  { kind: "product", query: "snacks", aliases: ["snacks", "knabberzeug", "knabbereien", "chips", "flips", "nachos", "popcorn", "nuesse", "nüsse", "trockenfruechte", "trockenfrüchte"] },
  { kind: "product", query: "schokolade", aliases: ["suessigkeiten", "süßigkeiten", "suesses", "süßes", "schokolade", "pralinen", "kekse", "gebaeck", "gebäck", "fruchtgummi", "gummibaerchen", "gummibärchen", "bonbons", "kaugummi", "riegel", "waffeln"] },
  { kind: "product", query: "eis", aliases: ["eis", "eiscreme", "ice cream"] },
  { kind: "product", query: "pizza", aliases: ["pizza", "pizzasorten", "pizza sorten", "tk pizza", "tiefkuehlpizza", "tiefkühlpizza"] },
  { kind: "product", query: "pasta", aliases: ["pasta", "nudeln", "spaghetti", "penne", "tortellini", "gnocchi", "frische pasta"] },
  { kind: "product", query: "reis", aliases: ["reis", "getreide", "couscous", "beilage", "beilagen"] },
  { kind: "product", query: "saucen", aliases: ["sauce", "saucen", "dressing", "dips", "dip", "pesto", "sugo", "aufstrich", "aufstriche"] },
  { kind: "product", query: "gewuerze", aliases: ["gewuerze", "gewürze", "salz", "pfeffer", "essig", "oel", "öl", "zum kochen"] },
  { kind: "product", query: "brot", aliases: ["brot", "backwaren", "baecker", "bäcker", "toast", "sandwich", "buns", "broetchen", "brötchen"] },
  { kind: "product", query: "milch", aliases: ["milch", "milchprodukte", "milchgetraenke", "milchgetränke", "hafermilch", "milchersatz", "milchersatzprodukte"] },
  { kind: "product", query: "joghurt", aliases: ["joghurt", "dessert", "desserts", "pudding", "milchsnacks"] },
  { kind: "product", query: "gemuese", aliases: ["gemuese", "gemüse", "frisches gemuese", "frisches gemüse", "tk gemuese", "tk gemüse", "tiefkuehlgemuese", "tiefkühlgemüse"] },
  { kind: "product", query: "obst", aliases: ["obst", "frisches obst"] },
  { kind: "product", query: "kraeuter", aliases: ["kraeuter", "kräuter", "frische kraeuter", "frische kräuter"] },
  { kind: "product", query: "fisch", aliases: ["fisch", "meeresfruechte", "meeresfrüchte", "tk fisch", "tiefgekuehlter fisch", "tiefgekühlter fisch"] },
  { kind: "product", query: "fleisch", aliases: ["fleisch", "tk fleisch", "tiefgekuehltes fleisch", "tiefgekühltes fleisch", "trockenfleisch"] },
  { kind: "product", query: "fertiggerichte", aliases: ["fertiggerichte", "fertigessen", "convenience", "instant nudeln", "reisgerichte", "tiefkuehlgerichte", "tiefkühlgerichte"] },
  { kind: "product", query: "backen", aliases: ["backen", "backzutaten", "backmischung", "backmischungen", "teig", "teige"] },
  { kind: "product", query: "kaffee", aliases: ["kaffee", "kaffeebohnen", "gemahlener kaffee", "ganze kaffeebohnen", "bohnenkaffee"] },
  { kind: "category", query: "baby", aliases: ["baby", "babyprodukte", "baby produkt", "babybedarf", "babysachen", "babynahrung", "babyzubehoer", "babyzubehör", "windeln"] },
  { kind: "category", query: "haushalt", aliases: ["haushalt", "haushaltsartikel", "haushaltswaren"] },
  { kind: "category", query: "putz", aliases: ["putzmittel", "putzen", "reinigung", "reiniger", "putzzubehoer", "putzzubehör"] },
  { kind: "category", query: "geschirr", aliases: ["geschirrspuelmittel", "geschirrspülen", "spuelmittel", "spülmittel"] },
  { kind: "category", query: "waesche", aliases: ["waesche", "wäsche", "waschmittel"] },
  { kind: "category", query: "wc", aliases: ["wc", "toilettenpapier", "klopapier", "wc papier"] },
  { kind: "category", query: "kuechenrolle", aliases: ["kuechenrolle", "küchenrolle", "taschentuecher", "taschentücher", "papier"] },
  { kind: "category", query: "batterien", aliases: ["batterien", "batterie"] },
  { kind: "category", query: "einweggeschirr", aliases: ["partybedarf", "servietten", "einweggeschirr"] },
  { kind: "category", query: "buero", aliases: ["buero", "büro", "bueroartikel", "büroartikel"] },
  { kind: "category", query: "geschenkpapier", aliases: ["geschenkpapier", "deko", "dekorieren"] },
  { kind: "category", query: "garten", aliases: ["garten"] },
  { kind: "category", query: "raucher", aliases: ["raucherbedarf", "raucherzubehoer", "raucherzubehör"] },
  { kind: "category", query: "vitamine", aliases: ["vitamine", "naehrstoffe", "nährstoffe", "sportnahrung", "functional food", "functional"] },
]

function resolveShopperBrowseTaxonomy(value: string): ShopperBrowseTaxonomy | null {
  const normalized = normalizeLoose(value)
  if (!normalized) return null
  let best: ShopperBrowseTaxonomy | null = null
  let bestAliasLength = 0
  for (const entry of SHOPPER_BROWSE_TAXONOMY) {
    for (const alias of entry.aliases) {
      const normalizedAlias = normalizeLoose(alias)
      if (!normalizedAlias) continue
      const exactMatch = normalized === normalizedAlias
      const tokenMatch = new RegExp(`(?:^|\\s)${escapeRegExp(normalizedAlias)}(?:$|\\s)`).test(normalized)
      if (exactMatch || tokenMatch) {
        if (normalizedAlias.length > bestAliasLength) {
          best = entry
          bestAliasLength = normalizedAlias.length
        }
      }
    }
  }
  return best
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function looksLikeBrandQuery(value: string): boolean {
  if (!value) return false
  const tokens = value.split(/\s+/).filter(Boolean)
  if (tokens.length > 3) return false
  return tokens.some((token) => /\b(oetker|barilla|kellys|chio|coca|rauch|red bull|nivea)\b/.test(token))
}

function parseBrowseIntent(value: string):
  | { kind: "category_query"; query: string }
  | { kind: "product_query"; query: string }
  | null {
  if (isMoreIntent(value)) {
    return null
  }
  if (/^(?:zeige(?:\s+mir)?(?:\s+bitte)?\s+)?(?:die\s+)?kategorien?$/.test(value)) {
    return {
      kind: "category_query",
      query: "",
    }
  }
  const categoryMatch = /^(?:browse|show|categories?|kategorien?)\s+(.+)$/.exec(value)
  if (categoryMatch) {
    return {
      kind: "category_query",
      query: categoryMatch[1]!.trim(),
    }
  }
  const germanCategoryMatch = /^(?:zeige(?:\s+mir)?|zeig(?:\s+mir)?)(?:\s+bitte)?\s+(.+)$/.exec(value)
  if (germanCategoryMatch) {
    const rawQuery = germanCategoryMatch[1]!
      .replace(/^(?:die|den|das)\s+/i, "")
      .replace(/^(?:alle|all)\s+/i, "")
      .trim()
    const query = canonicalizeBrowseQuery(rawQuery)
    if (!query || /^(?:kategorien?|kategorie)$/.test(query)) {
      return {
        kind: "category_query",
        query: "",
      }
    }
    const taxonomy = resolveShopperBrowseTaxonomy(rawQuery)
    if (taxonomy?.kind === "product") {
      return {
        kind: "product_query",
        query,
      }
    }
    if (taxonomy?.kind === "category") {
      return {
        kind: "category_query",
        query,
      }
    }
    if (isBroadFamilyBrowseQuery(query)) {
      return {
        kind: "product_query",
        query,
      }
    }
    return {
      kind: "category_query",
      query,
    }
  }
  const productMatch = /^(?:products?|show products?|artikel)\s+(.+)$/.exec(value)
  if (productMatch) {
    return {
      kind: "product_query",
      query: productMatch[1]!.trim(),
    }
  }
  return null
}

function parseImplicitBrowseIntent(value: string):
  | { kind: "category_query"; query: string }
  | { kind: "product_query"; query: string }
  | null {
  if (isMoreIntent(value) || isCancelIntent(value) || isRestartIntent(value)) {
    return null
  }
  const query = extractShoppingQuery(value)
  if (!looksLikeShoppingQuery(query)) return null
  const taxonomy = resolveShopperBrowseTaxonomy(query)
  if (taxonomy?.kind === "product") {
    return { kind: "product_query", query: canonicalizeBrowseQuery(query) }
  }
  if (taxonomy?.kind === "category") {
    return { kind: "category_query", query: canonicalizeBrowseQuery(query) }
  }
  if (isBroadFamilyBrowseQuery(query)) {
    return { kind: "product_query", query }
  }
  if (looksBroadCategoryQuery(query)) {
    return { kind: "category_query", query }
  }
  return { kind: "product_query", query }
}

function buildBrowseReply(result: Record<string, unknown>): string {
  const prompt = readString(result.prompt) || "Ich habe diese Optionen gefunden:"
  const hasMore = Boolean(result.hasMore)
  const options = Array.isArray(result.options)
    ? result.options
      .map((option, index) => {
        if (!option || typeof option !== "object") return null
        const record = option as Record<string, unknown>
        const label = formatBrowseOptionLabel(record)
        if (!label) return null
        return `${index + 1}. ${label}`
      })
      .filter((line): line is string => Boolean(line))
    : []

  if (!options.length) {
    return [
      toConversationalPrompt(prompt),
      "Ich habe gerade noch nichts Passendes gefunden.",
      "Wenn du magst, formuliere es etwas breiter wie 'Getraenke', 'Snacks' oder 'Pasta'.",
    ].join("\n")
  }

  return [
    toConversationalPrompt(prompt),
    ...options,
    "",
    hasMore
      ? "Es gibt noch mehr Treffer. Schreib einfach 'mehr' oder 'zeige alle', wenn ich weitermachen soll."
      : "Das ist die vollstaendige Liste fuer diese Anfrage.",
    "Antworte einfach mit 1, 2, 3 ... oder sag direkt, was du gern haettest.",
  ].join("\n")
}

function looksLikeRecipeMessage(value: string): boolean {
  if (isStatusIntent(value) || isCheckoutIntent(value) || isConfirmIntent(value)) return false
  if (parseCartMutation(value) || parseBrowseIntent(value)) return false
  return /\b(paella|lasagne|tacos|moussaka|kochen|machen|rezept|zutaten)\b/.test(value)
}

function shouldUseGroundedMealFlow(value: string): boolean {
  const normalized = normalizeLoose(value)
  if (!normalized) return false
  if (/\b(paella|lasagne|tacos|moussaka)\b/.test(normalized)) return false
  if (/\b(tortellini|gnocchi|risotto|curry|auflauf)\b/.test(normalized)) return true
  if (/\bpasta\b/.test(normalized) && !/\bvegetarische?\s+pasta\b/.test(normalized)) return false
  return /\bmit\b/.test(normalized)
    || /\b(gericht|kochen|essen)\b/.test(normalized)
    || /\b(fisch|gemuese|gemuse|kartoffel|reis|huhn|fleisch|sahne|tortellini)\b/.test(normalized)
}

function parseRefinementIntent(value: string):
  | { kind: "servings"; servings: number }
  | { kind: "modifier"; modifier: string; label: string; replySuffix: string }
  | null {
  const servingsMatch =
    /\bfuer\s+(\d{1,2})\b/.exec(value) ||
    /\bfür\s+(\d{1,2})\b/.exec(value) ||
    /\b(\d{1,2})\s+personen\b/.exec(value)
  if (servingsMatch?.[1]) {
    const servings = Math.trunc(Number(servingsMatch[1]))
    if (Number.isFinite(servings) && servings > 0) {
      return { kind: "servings", servings }
    }
  }
  if (/\bohne alkohol|alkoholfrei\b/.test(value)) {
    return { kind: "modifier", modifier: "alkoholfrei", label: "alkoholfreien Optionen", replySuffix: "alkoholfrei" }
  }
  if (/\bbio\b/.test(value)) {
    return { kind: "modifier", modifier: "bio", label: "Bio-Optionen", replySuffix: "mit Bio-Fokus" }
  }
  if (/\bvegetarisch|veggie\b/.test(value)) {
    return { kind: "modifier", modifier: "vegetarisch", label: "vegetarischen Optionen", replySuffix: "vegetarisch" }
  }
  if (/\bvegan\b/.test(value)) {
    return { kind: "modifier", modifier: "vegan", label: "veganen Optionen", replySuffix: "vegan" }
  }
  if (/\b(meeresfruechte|meer(?:es)?früchte|seafood)\b/.test(value)) {
    return { kind: "modifier", modifier: "mit meeresfruechten", label: "Varianten mit Meeresfruechten", replySuffix: "mit Meeresfruechten" }
  }
  if (/\bregional\b/.test(value)) {
    return { kind: "modifier", modifier: "regional", label: "regionalen Optionen", replySuffix: "mit regionalem Fokus" }
  }
  if (/\b(guenstig|günstig|billig)\b/.test(value)) {
    return { kind: "modifier", modifier: "guenstig", label: "guenstigeren Optionen", replySuffix: "etwas guenstiger" }
  }
  return null
}

function looksBroadCategoryQuery(value: string): boolean {
  const taxonomy = resolveShopperBrowseTaxonomy(value)
  if (taxonomy) return taxonomy.kind === "category"
  return /\b(getraenke|getränke|bier|wein|snacks?|pasta|reis|gemuese|gemüse|milch|brot|kaese|käse|fruehstueck|frühstück)\b/.test(value)
}

function isBroadFamilyBrowseQuery(value: string): boolean {
  const taxonomy = resolveShopperBrowseTaxonomy(value)
  if (taxonomy) return taxonomy.kind === "product"
  return /\b(getraenke|getränke|drinks?|bier|wein|snacks?|chips|softdrinks?)\b/.test(value)
}

function looksLikeShoppingQuery(value: string): boolean {
  if (!value.trim()) return false
  if (isStatusIntent(value) || isCheckoutIntent(value) || isConfirmIntent(value)) return false
  if (isMoreIntent(value) || isCancelIntent(value) || isRestartIntent(value)) return false
  if (parseCartMutation(value) || parseBrowseIntent(value) || looksLikeRecipeMessage(value)) return false
  const words = value.split(/\s+/).filter(Boolean)
  if (words.length <= 4 || looksBroadCategoryQuery(value)) return true
  return /\b(ich brauche|ich suche|wir brauchen|zeig mir|zeig uns|gib mir|hast du)\b/.test(value)
}

function extractShoppingQuery(value: string): string {
  const match =
    /^(?:ich\s+(?:brauche|suche|haette gern|hätte gern|moechte|möchte)|wir\s+brauchen|zeig(?:\s+mir|\s+uns)?|gib\s+mir|hast\s+du)(?:\s+noch)?\s+(.+)$/.exec(value)
  if (!match?.[1]) return value
  return match[1]
    .replace(/\b(?:auch|bitte|mal|noch)\b/g, " ")
    .replace(/\b(?:heute\s+aben(?:d)?|fuer\s+heute\s+aben(?:d)?|für\s+heute\s+aben(?:d)?)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

function buildRecipeReply(result: Record<string, unknown>): string {
  const title = readString(result.recipeTitle) || "dein Gericht"
  const options = Array.isArray(result.options)
    ? result.options
      .map((option, index) => {
        if (!option || typeof option !== "object") return null
        const record = option as Record<string, unknown>
        const label = formatBrowseOptionLabel(record)
        return label ? `${index + 1}. ${label}` : null
      })
      .filter((line): line is string => Boolean(line))
    : []
  const unresolved = Array.isArray(result.unresolvedIngredients)
    ? result.unresolvedIngredients.filter((value): value is string => typeof value === "string" && Boolean(value.trim()))
    : []

  if (!options.length) {
    return [
      `Ich habe ${title} erkannt, aber im aktuellen Alfies-Katalog noch keine sichere Einkaufsauswahl dafuer gebaut.`,
      unresolved.length ? `Naheliegende Zutaten waeren: ${unresolved.join(", ")}.` : null,
      "Sag zum Beispiel 'vegetarisch', 'mit Meeresfruechten' oder nenne einzelne Zutaten wie 'Reis' oder 'Paprika', dann gehe ich gezielter weiter.",
    ].filter(Boolean).join("\n")
  }

  return [
    `Fuer ${title} habe ich dir eine erste Einkaufsauswahl zusammengestellt:`,
    "",
    ...options,
    ...(unresolved.length
      ? ["", `Noch offen: ${unresolved.join(", ")}.`]
      : []),
    "",
    "Wenn das fuer dich passt, antworte einfach mit 'alles'.",
    "Oder sag zum Beispiel 'fuer 4', 'vegetarisch', 'mit Meeresfruechten' oder nenne eine Zahl.",
  ].join("\n")
}

function readMealCandidateGroups(value: Record<string, unknown>): Array<{
  ingredient: string
  options: Array<Record<string, unknown>>
}> {
  const groups = Array.isArray(value.groups) ? value.groups : []
  return groups
    .map((group) => {
      if (!group || typeof group !== "object") return null
      const record = group as Record<string, unknown>
      const ingredient = readString(record.ingredient)
      const options = Array.isArray(record.options)
        ? record.options.filter((option): option is Record<string, unknown> => Boolean(option) && typeof option === "object")
        : []
      if (!ingredient || !options.length) return null
      return { ingredient, options }
    })
    .filter((group): group is { ingredient: string; options: Array<Record<string, unknown>> } => Boolean(group))
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
    : []
}

function buildMealSuggestionReply(result: {
  title: string
  intro?: string
  followUpQuestion?: string
  unresolvedIngredients: string[]
  options: Array<Record<string, unknown>>
}): string {
  const options = result.options
    .map((option, index) => {
      const label = formatBrowseOptionLabel(option)
      return label ? `${index + 1}. ${label}` : null
    })
    .filter((line): line is string => Boolean(line))

  return [
    result.intro || `Ich habe dir fuer ${result.title} eine erste, passende Auswahl zusammengestellt:`,
    "",
    ...options,
    ...(result.unresolvedIngredients.length
      ? ["", `Offen fuer die naechste Entscheidung: ${result.unresolvedIngredients.join(", ")}.`]
      : []),
    "",
    result.followUpQuestion || "Wenn das fuer dich gut aussieht, antworte mit 'alles'. Oder sag mir direkt, was ich anpassen soll.",
  ].join("\n")
}

function titleCaseLoose(value: string): string {
  return String(value || "")
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ")
}

function formatBrowseOptionLabel(option: Record<string, unknown>): string | null {
  const label = readString(option.label) || readString(option.value)
  if (!label) return null
  const unitPriceCents = readNumber(option.unitPriceCents ?? option.unit_price_cents)
  if (typeof unitPriceCents !== "number") return label
  const currency = readString(option.currency) || "EUR"
  return `${label} (${formatAmount(unitPriceCents, currency)})`
}

function buildWelcomeReply(): string {
  return [
    "Ich bin dein Alfies Concierge auf WhatsApp.",
    "Ich stelle dir aus einer Idee schnell einen passenden Einkauf zusammen und begleite dich bis zum Checkout.",
    "",
    "Am besten funktioniert es so:",
    "- Schreib mir dein Ziel ganz normal, zum Beispiel ein Gericht, eine Kategorie oder ein Produkt.",
    "- Sag wichtige Details direkt dazu, zum Beispiel 'fuer 4', 'vegetarisch', 'ohne Alkohol' oder 'guenstig'.",
    "- Wenn ich dir eine Liste schicke, antworte einfach mit einer Zahl, 'mehr' oder 'zeige alle'.",
    "- Wenn dir mein Vorschlag passt, schreib 'alles'. Fuer Zahlung und Stand gehen auch 'checkout' und 'status'.",
    "",
    "Du kannst ganz normal schreiben, zum Beispiel:",
    "- 'Ich moechte Paella machen heute'",
    "- 'Ich brauche Getraenke fuer heute abend'",
    "- 'Pack Bio-Milch dazu'",
    "- 'Zeig mir Snacks'",
    "- '1cent' fuer einen Test-Checkout",
    "",
    "Wenn du schon etwas im Kopf hast, legen wir direkt los.",
  ].join("\n")
}

function toConversationalPrompt(prompt: string): string {
  if (/\?$/.test(prompt)) return prompt
  if (/welche/i.test(prompt)) return `${prompt}`
  return `${prompt} Was klingt fuer dich gut?`
}

function buildOneCentCart(): Record<string, unknown> {
  return {
    items: [
      {
        sku: "test-1cent",
        name: "1-Cent Testcheckout",
        qty: 1,
        unit_price_cents: 1,
        currency: "EUR",
      },
    ],
    total_cents: 1,
    currency: "EUR",
  }
}
