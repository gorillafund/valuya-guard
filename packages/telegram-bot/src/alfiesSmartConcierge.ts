import { randomUUID } from "node:crypto"
import { resolve } from "node:path"
import { findAlternativesForCartItems, resolveProductsFromCatalog } from "../../whatsapp-bot/dist/whatsapp-bot/src/alfiesProductResolver.js"
import { applyCartMutation } from "../../whatsapp-bot/dist/whatsapp-bot/src/cartMutationService.js"
import { ConversationStateService, type ConversationSnapshot } from "../../whatsapp-bot/dist/whatsapp-bot/src/conversationStateService.js"
import { ContextGovernanceService } from "../../whatsapp-bot/dist/whatsapp-bot/src/contextGovernanceService.js"
import { IntentExtractionService } from "../../whatsapp-bot/dist/whatsapp-bot/src/intentExtractionService.js"
import {
  buildCategorySelectionOptions,
  buildMatchingCategoryOptions,
  buildOccasionSelectionOptions,
  buildProductsForCategoryOptions,
  buildProductSelectionOptions,
  formatPendingOptionsMessage,
  resolvePendingOptionSelection,
} from "../../whatsapp-bot/dist/whatsapp-bot/src/optionSelectionService.js"
import { buildActiveProductContextReply } from "../../whatsapp-bot/dist/whatsapp-bot/src/productContextService.js"
import { looksLikeRecipeRequest, resolveRecipeRequest } from "../../whatsapp-bot/dist/whatsapp-bot/src/recipeService.js"
import { ReferenceResolutionService } from "../../whatsapp-bot/dist/whatsapp-bot/src/referenceResolutionService.js"
import { ShoppingRouter } from "../../whatsapp-bot/dist/whatsapp-bot/src/shoppingRouter.js"
import {
  FileStateStore,
  normalizeCart,
  type CartState,
  type ConversationProfile,
  type PendingOption,
  type ShoppingPreferences,
  type StoredAlfiesProduct,
} from "../../whatsapp-bot/dist/whatsapp-bot/src/stateStore.js"

type TelegramButton = {
  text: string
  callback_data?: string
  url?: string
}

type TelegramMarkup = {
  inline_keyboard: TelegramButton[][]
}

export type TelegramConciergeAction = "confirm" | "alt" | "cancel" | "status"

export type TelegramConciergeResponse = {
  ok: boolean
  orderId: string
  telegram: {
    text: string
    keyboard?: TelegramMarkup
  }
  recipe?: { title?: string }
  cart?: { items?: unknown[]; total_cents?: number; currency?: string }
}

export type TelegramLocalOrderContext = {
  orderId?: string
  recipeTitle?: string
  cart?: CartState
}

export class TelegramSmartConcierge {
  private readonly stateStore: FileStateStore
  private readonly conversationState: ConversationStateService
  private readonly contextGovernance = new ContextGovernanceService()
  private readonly intentExtractor: IntentExtractionService
  private readonly referenceResolution = new ReferenceResolutionService()
  private readonly shoppingRouter = new ShoppingRouter()

  constructor(args?: {
    stateFile?: string
    apiKey?: string
    model?: string
  }) {
    const stateFile =
      args?.stateFile?.trim() || process.env.TELEGRAM_SMART_STATE_FILE?.trim() ||
      process.env.WHATSAPP_STATE_FILE?.trim() ||
      resolve(process.cwd(), ".data/telegram-smart-state.sqlite")
    this.stateStore = new FileStateStore(stateFile)
    this.conversationState = new ConversationStateService(this.stateStore)
    this.intentExtractor = new IntentExtractionService({
      apiKey: args?.apiKey || process.env.OPENAI_API_KEY?.trim(),
      model: args?.model || process.env.OPENAI_MODEL?.trim() || "gpt-4.1-mini",
    })
  }

  async handleMessage(args: {
    subjectId: string
    message: string
    existingOrderId?: string
  }): Promise<TelegramConciergeResponse | null> {
    const message = String(args.message || "").trim()
    if (!message) return null

    const snapshot = await this.conversationState.getSnapshot(args.subjectId)
    const catalog = await this.stateStore.listAlfiesProducts()
    const orderId = args.existingOrderId || snapshot.conversation?.orderId || randomUUID()

    await this.conversationState.recordInboundMessage(args.subjectId, message)

    if (isHelpRequest(message)) {
      return await this.reply(args.subjectId, orderId, {
        text: buildStartText(),
        cart: snapshot.profile?.currentCartSnapshot,
      })
    }

    if (isCancelRequest(message)) {
      await this.conversationState.clearActiveProduct(args.subjectId)
      await this.conversationState.clearPendingOptions(args.subjectId)
      await this.stateStore.upsertProfile(args.subjectId, {
        profile: { pendingDialog: undefined },
      })
      return await this.reply(args.subjectId, orderId, {
        text: [
          "Bestellung abgebrochen.",
          "",
          "Wenn du neu starten willst, sende einfach einen neuen Wunsch oder 'start'.",
          "",
          "Zum Beispiel:",
          "• Milch",
          "• Getraenke fuer 6",
          "• vegetarian pasta for 2",
          "• Kategorien",
        ].join("\n"),
      })
    }

    if (isShowCartRequest(message)) {
      const cart = normalizeCart(snapshot.profile?.currentCartSnapshot)
      return await this.reply(args.subjectId, orderId, {
        text: formatCartOverview(cart),
        cart,
      })
    }

    if (isStatusRequest(message)) {
      const cart = normalizeCart(snapshot.profile?.currentCartSnapshot)
      return await this.reply(args.subjectId, orderId, {
        text: cart?.items?.length
          ? `Dein aktueller Warenkorb hat ${cart.items.length} Positionen.\n\n${formatCartOverview(cart)}`
          : "Ich habe aktuell noch keinen aktiven Warenkorb fuer dich.",
        cart,
      })
    }

    if (message.toLowerCase() === "alt") {
      return this.handleAction({ subjectId: args.subjectId, orderId, action: "alt" })
    }

    const paged = await this.handlePendingPaging(args.subjectId, orderId, message, snapshot, catalog)
    if (paged) return paged

    const pendingResolved = await this.handlePendingSelection(args.subjectId, orderId, message, snapshot, catalog)
    if (pendingResolved) return pendingResolved

    if (looksLikeRecipeRequest(message)) {
      await this.conversationState.clearActiveProduct(args.subjectId)
      await this.conversationState.clearPendingOptions(args.subjectId)
      return this.handleRecipeRequest(args.subjectId, orderId, message, snapshot, catalog)
    }

    const productContextReply = buildActiveProductContextReply({
      message,
      snapshot,
      catalog,
    })
    if (productContextReply) {
      await this.conversationState.recordAssistantMessage(args.subjectId, productContextReply.text)
      if (productContextReply.nextQuestion) {
        const active = snapshot.profile?.activeProductCandidate
        if (active) {
          await this.conversationState.setActiveProduct(args.subjectId, {
            product: active,
            question: productContextReply.nextQuestion,
            editMode: snapshot.profile?.activeEditMode,
          })
        }
      }
      return {
        ok: true,
        orderId,
        telegram: { text: productContextReply.text },
      }
    }

    const activeQuantityReply = await this.handleQuantityReply(args.subjectId, orderId, message, snapshot, catalog)
    if (activeQuantityReply) return activeQuantityReply

    if (looksLikeBroadCategoryRequest(message)) {
      const selectionMode = inferSelectionMode(message, snapshot)
      const categoryOptions = buildMatchingCategoryOptions({
        query: message,
        products: catalog,
        limit: 8,
      })
      const options = categoryOptions.length
        ? categoryOptions
        : buildCategorySelectionOptions(catalog, 8)
      await this.conversationState.setPendingOptions(args.subjectId, {
        kind: "category_selection",
        prompt: selectionMode === "add_to_existing_cart"
          ? "Alles klar, ich ergaenze eine weitere Kategorie. Welche meinst du?"
          : "Welche Kategorie moechtest du durchsuchen?",
        options,
        offset: 0,
        sourceQuery: message,
        selectionMode,
      })
      return await this.reply(args.subjectId, orderId, {
        text: formatPendingOptionsMessage(
          selectionMode === "add_to_existing_cart"
            ? "Alles klar, ich ergaenze eine weitere Kategorie. Welche meinst du?"
            : "Welche Kategorie moechtest du durchsuchen?",
          options,
        ),
      })
    }

    const extraction = await this.intentExtractor.extract({
      message,
      contextSummary: this.conversationState.buildContextSummary(snapshot),
    })
    const referenceResolution = this.referenceResolution.resolve({ extraction, snapshot })
    const governance = this.contextGovernance.evaluate({ extraction, snapshot })
    const route = this.shoppingRouter.route({ extraction, referenceResolution, governance })

    if (route.kind === "cart_mutation") {
      const mutation = applyCartMutation({
        cart: snapshot.profile?.currentCartSnapshot,
        extraction,
        catalog,
        resolvedReference: route.resolvedReference,
      })
      if (mutation.kind === "clarify") {
        return await this.reply(args.subjectId, orderId, { text: mutation.message })
      }
      await this.persistCart(args.subjectId, orderId, mutation.cart, undefined)
      if (mutation.activeProduct) {
        await this.conversationState.setActiveProduct(args.subjectId, {
          product: mutation.activeProduct,
          editMode: extraction.cart_action === "add" ? "add_to_existing_cart" : "update_existing_item_quantity",
        })
      }
      return await this.reply(args.subjectId, orderId, {
        text: [
          mutation.message,
          "",
          formatCartOverview(mutation.cart),
          "",
          "Naechste Schritte: 'order' zum Bestellen, 'Warenkorb' zum Bearbeiten, 'alt' fuer Alternativen.",
        ].join("\n"),
        cart: mutation.cart,
      })
    }

    if (route.kind === "browse_category" || route.kind === "search_product" || route.kind === "unknown" || route.kind === "clarify") {
      const selectionMode = inferSelectionMode(message, snapshot)
      const categoryOptions = buildMatchingCategoryOptions({
        query: message,
        products: catalog,
        limit: 8,
      })
      if (categoryOptions.length) {
        await this.conversationState.setPendingOptions(args.subjectId, {
          kind: "category_selection",
          prompt: "Welche Kategorie moechtest du durchsuchen?",
          options: categoryOptions,
          offset: 0,
          sourceQuery: message,
          selectionMode,
        })
        return await this.reply(args.subjectId, orderId, {
          text: formatPendingOptionsMessage("Welche Kategorie moechtest du durchsuchen?", categoryOptions),
        })
      }

      const productOptions = buildProductSelectionOptions({
        query: message,
        products: catalog,
        limit: 8,
      })
      if (productOptions.length) {
        await this.conversationState.setPendingOptions(args.subjectId, {
          kind: "product_selection",
          prompt: `Was moechtest du aus ${message.trim()}?`,
          options: productOptions,
          offset: 0,
          sourceQuery: message,
          selectionMode,
        })
        return await this.reply(args.subjectId, orderId, {
          text: formatPendingOptionsMessage(`Was moechtest du aus ${message.trim()}?`, productOptions),
        })
      }

      return await this.reply(args.subjectId, orderId, {
        text: route.kind === "clarify" || route.kind === "unknown"
          ? route.question
          : "Ich konnte dazu noch keine guten Treffer finden. Nenne die Kategorie oder das Produkt bitte etwas genauer.",
      })
    }

    if (route.kind === "help") {
      return await this.reply(args.subjectId, orderId, { text: buildStartText() })
    }

    if (route.kind === "show_cart") {
      const cart = normalizeCart(snapshot.profile?.currentCartSnapshot)
      return await this.reply(args.subjectId, orderId, { text: formatCartOverview(cart), cart })
    }

    return await this.reply(args.subjectId, orderId, {
      text: "Was soll ich fuer dich suchen oder zusammenstellen?",
    })
  }

  async handleAction(args: {
    subjectId: string
    orderId: string
    action: TelegramConciergeAction
  }): Promise<TelegramConciergeResponse | null> {
    const snapshot = await this.conversationState.getSnapshot(args.subjectId)
    const cart = normalizeCart(snapshot.profile?.currentCartSnapshot)
    if (!cart && args.action !== "cancel" && args.action !== "status") return null

    if (args.action === "cancel") {
      await this.conversationState.clearActiveProduct(args.subjectId)
      await this.conversationState.clearPendingOptions(args.subjectId)
      return await this.reply(args.subjectId, args.orderId, {
        text: "Alles klar - Bestellung abgebrochen. Sende einfach einen neuen Wunsch.",
      })
    }

    if (args.action === "status") {
      return await this.reply(args.subjectId, args.orderId, {
        text: formatCartOverview(cart),
        cart,
      })
    }

    if (args.action === "confirm") {
      return await this.reply(args.subjectId, args.orderId, {
        text: "Alles klar. Ich uebergebe die Bestellung jetzt an den bestehenden Payment- und Backend-Flow.",
        cart,
      })
    }

    const catalog = await this.stateStore.listAlfiesProducts()
    const alternatives = findAlternativesForCartItems({
      cart: cart || {},
      products: catalog,
      preferences: snapshot.profile?.shoppingPreferences,
    })
    if (!alternatives.items.length) {
      return await this.reply(args.subjectId, args.orderId, {
        text: "Ich finde fuer den aktuellen Warenkorb gerade keine sinnvollen Alternativen.",
        cart,
      })
    }
    const nextCart = {
      items: alternatives.items.map((entry) => ({
        product_id: entry.alternative.product_id,
        sku: entry.alternative.slug || String(entry.alternative.product_id),
        name: entry.alternative.title,
        qty: entry.quantity,
        unit_price_cents: entry.alternative.price_cents || 0,
        currency: entry.alternative.currency || "EUR",
      })),
      total_cents: alternatives.items.reduce(
        (sum, entry) => sum + entry.quantity * (entry.alternative.price_cents || 0),
        0,
      ),
      currency: alternatives.items[0]?.alternative.currency || cart?.currency || "EUR",
    }
    await this.persistCart(args.subjectId, args.orderId, nextCart, snapshot.profile?.selectedRecipeTitle)
    return await this.reply(args.subjectId, args.orderId, {
      text: [
        "Alternative Basket",
        "",
        "Hier ist eine Alternative mit leicht anderer Auswahl und Preisstruktur.",
        "",
        "Aktualisierter Warenkorb:",
        ...alternatives.items.map((entry) =>
          `• ${entry.quantity}x ${entry.alternative.title} (${formatMoney(entry.quantity * (entry.alternative.price_cents || 0), entry.alternative.currency || "EUR")})`,
        ),
        "",
        `Neue Zwischensumme: ${formatMoney(nextCart.total_cents, nextCart.currency)}`,
        "",
        "Naechste Schritte:",
        "order = ✅ Bestellen",
        "alt = 🔁 Alternativen",
        "cancel = ❌ Abbrechen",
        "status = ℹ️ Status",
      ].join("\n"),
        cart: nextCart,
      })
  }

  async getOrderContext(subjectId: string): Promise<TelegramLocalOrderContext> {
    const snapshot = await this.conversationState.getSnapshot(subjectId)
    return {
      orderId: snapshot.conversation?.orderId,
      recipeTitle: snapshot.profile?.selectedRecipeTitle,
      cart: normalizeCart(snapshot.profile?.currentCartSnapshot || snapshot.conversation?.lastCart),
    }
  }

  private async handleRecipeRequest(
    subjectId: string,
    orderId: string,
    message: string,
    snapshot: ConversationSnapshot,
    catalog: StoredAlfiesProduct[],
  ): Promise<TelegramConciergeResponse> {
    const recipe = resolveRecipeRequest(message)
    if (!recipe) {
      return this.reply(subjectId, orderId, {
        text: "Welches Gericht moechtest du kochen? Zum Beispiel 'Paella', 'Musaka' oder 'Lasagne'.",
      })
    }
    const recipeMessage = recipe.ingredients.join(" ")
    const resolved = resolveProductsFromCatalog(
      recipeMessage,
      catalog,
      snapshot.profile?.shoppingPreferences,
      undefined,
      recipe,
    )
    if (!resolved?.lines.length) {
      return this.reply(subjectId, orderId, {
        text: `Ich habe fuer ${recipe.title} noch keine gute Zutaten-Zuordnung im Katalog gefunden. Soll ich mit den Kernzutaten starten?`,
        recipeTitle: recipe.title,
      })
    }

    const items = resolved.lines
      .map((line) => catalog.find((product) => product.product_id === line.id))
      .filter((product): product is StoredAlfiesProduct => Boolean(product))
      .map((product, index) => ({
        product_id: product.product_id,
        sku: product.slug || String(product.product_id),
        name: product.title,
        qty: resolved.lines[index]?.quantity || 1,
        unit_price_cents: product.price_cents || 0,
        currency: product.currency || "EUR",
      }))
    const cart = {
      items,
      total_cents: items.reduce((sum, item) => sum + Math.trunc(Number(item.qty || 0)) * Math.trunc(Number(item.unit_price_cents || 0)), 0),
      currency: items[0]?.currency || "EUR",
    }
    await this.persistCart(subjectId, orderId, cart, recipe.title)
    return this.reply(subjectId, orderId, {
      text: [
        `Zutaten fuer ${recipe.title}`,
        "",
        "Ich habe passende Zutaten im Alfies-Katalog gefunden.",
        "",
        ...items.map((item) => `• ${item.qty}x ${item.name} (${formatMoney(Math.trunc(Number(item.qty || 0)) * Math.trunc(Number(item.unit_price_cents || 0)), item.currency || "EUR")})`),
        "",
        `Zwischensumme: ${formatMoney(cart.total_cents, cart.currency)}`,
        "",
        "Wenn du einen der Vorschlaege direkt auswaehlen willst, antworte mit Nummer oder Produktname.",
      ].join("\n"),
      recipeTitle: recipe.title,
      cart,
    })
  }

  private async handlePendingPaging(
    subjectId: string,
    orderId: string,
    message: string,
    snapshot: ConversationSnapshot,
    catalog: StoredAlfiesProduct[],
  ): Promise<TelegramConciergeResponse | null> {
    const pending = snapshot.profile?.pendingOptions
    if (!pending || !isMoreRequest(message)) return null
    const nextOffset = (pending.offset || 0) + pending.options.length
    let options: PendingOption[] = []
    if (pending.kind === "category_selection") {
      options = pending.sourceQuery
        ? buildMatchingCategoryOptions({
            query: pending.sourceQuery,
            products: catalog,
            limit: 8,
            offset: nextOffset,
          })
        : buildCategorySelectionOptions(catalog, 8, nextOffset)
    } else if (pending.kind === "product_selection") {
      if (pending.sourceCategory) {
        options = buildProductsForCategoryOptions({
          category: pending.sourceCategory,
          products: catalog,
          limit: 8,
          offset: nextOffset,
        })
      } else if (pending.sourceQuery) {
        options = buildProductSelectionOptions({
          query: pending.sourceQuery,
          products: catalog,
          limit: 8,
          offset: nextOffset,
        })
      }
    }
    if (!options.length) {
      return this.reply(subjectId, orderId, {
        text: "Ich habe keine weiteren Treffer in dieser Auswahl.",
      })
    }
    await this.conversationState.setPendingOptions(subjectId, {
      ...pending,
      options,
      offset: nextOffset,
    })
    return this.reply(subjectId, orderId, {
      text: formatPendingOptionsMessage(pending.prompt, options),
    })
  }

  private async handlePendingSelection(
    subjectId: string,
    orderId: string,
    message: string,
    snapshot: ConversationSnapshot,
    catalog: StoredAlfiesProduct[],
  ): Promise<TelegramConciergeResponse | null> {
    const pending = snapshot.profile?.pendingOptions
    if (!pending?.options?.length) return null
    const selection = resolvePendingOptionSelection(message, pending)
    if (!selection) return null

    if (pending.kind === "category_selection") {
      const pendingSelectionMode = pending.selectionMode
      let categoryLabel = selection.label
      const products = buildProductsForCategoryOptions({
        category: categoryLabel,
        products: catalog,
        limit: 8,
      })
      if (!products.length) {
        return this.reply(subjectId, orderId, {
          text: `Ich finde aktuell keine Produkte in ${selection.label}.`,
        })
      }
      const nextSelectionMode = pendingSelectionMode
        || (
          snapshot.profile?.currentCartSnapshot?.items?.length &&
          (
            snapshot.profile?.activeEditMode === "add_to_existing_cart" ||
            isAdditiveCategoryRequest(snapshot.profile?.latestMessage || message) ||
            !isExplicitReplaceOrNarrowRequest(snapshot.profile?.latestMessage || message)
          )
            ? "add_to_existing_cart"
            : undefined
        )
      await this.conversationState.setPendingOptions(subjectId, {
        kind: "product_selection",
        prompt: `Was moechtest du aus ${categoryLabel}?`,
        options: products,
        offset: 0,
        sourceCategory: categoryLabel,
        selectionMode: nextSelectionMode,
      })
      await this.conversationState.clearActiveProduct(subjectId)
      if (nextSelectionMode === "add_to_existing_cart") {
        await this.conversationState.setActiveProduct(subjectId, {
          product: undefined,
          question: undefined,
          editMode: "add_to_existing_cart",
        })
      }
      return this.reply(subjectId, orderId, {
        text: formatPendingOptionsMessage(`Was moechtest du aus ${categoryLabel}?`, products),
      })
    }

    if (pending.kind === "product_selection") {
      await this.conversationState.clearPendingOptions(subjectId)
      await this.conversationState.setActiveProduct(subjectId, {
        product: {
          productId: selection.productId,
          sku: selection.sku,
          title: selection.label,
          unitPriceCents: selection.unitPriceCents,
          currency: selection.currency,
        },
        question: {
          kind: "quantity_for_product",
          productTitle: selection.label,
        },
        editMode:
          pending.selectionMode === "add_to_existing_cart"
            ? "add_to_existing_cart"
            : snapshot.profile?.activeEditMode === "add_to_existing_cart"
              ? "add_to_existing_cart"
              : "replace_with_single_product",
      })
      return this.reply(subjectId, orderId, {
        text:
          (
            pending.selectionMode === "add_to_existing_cart" ||
            snapshot.profile?.activeEditMode === "add_to_existing_cart"
          )
            ? `Wie viele Einheiten ${selection.label} soll ich zusaetzlich in den Warenkorb legen?`
            : `Wie viele Einheiten ${selection.label} moechtest du bestellen?`,
      })
    }

    return null
  }

  private async handleQuantityReply(
    subjectId: string,
    orderId: string,
    message: string,
    snapshot: ConversationSnapshot,
    catalog: StoredAlfiesProduct[],
  ): Promise<TelegramConciergeResponse | null> {
    const activeQuestion = snapshot.profile?.activeQuestion
    const activeProduct = snapshot.profile?.activeProductCandidate
    if (activeQuestion?.kind !== "quantity_for_product" || !activeProduct?.title) return null
    const qty = extractLeadingQuantity(message)
    if (!qty) return null
    const product = catalog.find((entry) =>
      (activeProduct.productId && entry.product_id === activeProduct.productId) ||
      (activeProduct.sku && entry.slug === activeProduct.sku) ||
      normalize(entry.title) === normalize(activeProduct.title),
    )
    if (!product) return null

    const cart = normalizeCart(snapshot.profile?.currentCartSnapshot) || { items: [], total_cents: 0, currency: product.currency || "EUR" }
    const mode = snapshot.profile?.activeEditMode || "replace_with_single_product"
    const nextItems = Array.isArray(cart.items)
      ? cart.items.filter((item) => mode === "add_to_existing_cart" || !matchesCartItem(item, product))
      : []
    if (mode !== "add_to_existing_cart") {
      nextItems.length = 0
    }
    nextItems.push({
      product_id: product.product_id,
      sku: product.slug || String(product.product_id),
      name: product.title,
      qty,
      unit_price_cents: product.price_cents || 0,
      currency: product.currency || "EUR",
    })
    const mergedItems = mergeDuplicateItems(nextItems) as Record<string, unknown>[]
    const nextCart = {
      items: mergedItems,
      total_cents: 0,
      currency: product.currency || cart.currency || "EUR",
    }
    nextCart.total_cents = mergedItems.reduce(
      (sum: number, item) => sum + Math.trunc(Number(item.qty || 0)) * Math.trunc(Number(item.unit_price_cents || 0)),
      0,
    )
    await this.persistCart(subjectId, orderId, nextCart, snapshot.profile?.selectedRecipeTitle)
    await this.conversationState.clearActiveProduct(subjectId)
    return this.reply(subjectId, orderId, {
      text: [
        mode === "add_to_existing_cart"
          ? `Ich habe ${qty}x ${product.title} zum Warenkorb hinzugefuegt.`
          : `Ich stelle den Warenkorb auf ${product.title} um.`,
        "",
        formatCartOverview(nextCart),
        "",
        "Naechste Schritte: 'order' zum Bestellen, 'Warenkorb' zum Bearbeiten, 'alt' fuer Alternativen.",
      ].join("\n"),
      cart: nextCart,
    })
  }

  private async persistCart(
    subjectId: string,
    orderId: string,
    cart: CartState | undefined,
    recipeTitle?: string,
  ): Promise<void> {
    await this.stateStore.upsert(subjectId, {
      orderId,
      lastCart: cart,
      lastRecipe: recipeTitle ? { title: recipeTitle } : undefined,
    })
    await this.conversationState.recordRecipeAndCart(subjectId, {
      recipeTitle,
      cart,
    })
    if (cart?.items?.length) {
      await this.conversationState.recordShownProducts(
        subjectId,
        cart.items
          .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
          .map((item) => ({
            productId: typeof item.product_id === "number" ? Math.trunc(item.product_id) : undefined,
            sku: typeof item.sku === "string" ? item.sku : undefined,
            title: String(item.name || item.title || "Artikel"),
          })),
      )
    }
  }

  private async reply(
    subjectId: string,
    orderId: string,
    args: { text: string; cart?: CartState; recipeTitle?: string },
  ): Promise<TelegramConciergeResponse> {
    await this.conversationState.recordAssistantMessage(subjectId, args.text)
    return {
      ok: true,
      orderId,
      telegram: {
        text: args.text,
        keyboard: actionKeyboard(orderId),
      },
      recipe: args.recipeTitle ? { title: args.recipeTitle } : undefined,
      cart: args.cart,
    }
  }
}

function buildStartText(): string {
  return [
    "Alfies Concierge auf Telegram.",
    "",
    "Ich helfe dir beim Einkauf ueber Alfies.",
    "Du kannst Rezepte entdecken, Zutaten fuer ein Gericht zusammenstellen, direkt nach Produkten suchen, Kategorien durchsuchen und deinen Warenkorb bearbeiten.",
    "Danach kannst du Alternativen anfordern, bezahlen und den Status pruefen.",
    "",
    "So startest du:",
    "• Sende ein Gericht: 'vegetarian pasta for 2'",
    "• Oder einen Anlass: 'snacks for movie night'",
    "• Oder direkt ein Produkt: 'Milch', 'Hafermilch', 'Tegernseer Helles'",
    "• Oder eine Kategorie: 'Kategorien' oder 'zeige mir Milchprodukte'",
  ].join("\n")
}

function actionKeyboard(orderId: string): TelegramMarkup {
  return {
    inline_keyboard: [
      [{ text: "✅ Bestellen", callback_data: `confirm:${orderId}` }],
      [{ text: "🔁 Alternativen", callback_data: `alt:${orderId}` }],
      [{ text: "❌ Abbrechen", callback_data: `cancel:${orderId}` }],
    ],
  }
}

function formatCartOverview(cart: CartState | undefined): string {
  const items = Array.isArray(cart?.items) ? cart.items : []
  if (!items.length) return "Dein Warenkorb ist aktuell leer."
  const lines = [
    "Aktueller Warenkorb:",
    ...items
      .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
      .map((item, index) =>
        `${index + 1}. ${Math.trunc(Number(item.qty || 1))}x ${String(item.name || item.title || "Artikel")} (${formatMoney(Math.trunc(Number(item.qty || 1)) * Math.trunc(Number(item.unit_price_cents || 0)), String(item.currency || cart?.currency || "EUR"))})`,
      ),
    "",
    `Zwischensumme: ${formatMoney(Math.trunc(Number(cart?.total_cents || 0)), String(cart?.currency || "EUR"))}`,
  ]
  return lines.join("\n")
}

function formatMoney(cents: number, currency: string): string {
  return `${(cents / 100).toFixed(2)} ${currency}`
}

function isHelpRequest(message: string): boolean {
  return /^(help|hilfe|start|\/start|\/help)$/i.test(message.trim())
}

function isCancelRequest(message: string): boolean {
  return /^(cancel|abbrechen)$/i.test(message.trim())
}

function isStatusRequest(message: string): boolean {
  return /^(status|\/status)$/i.test(message.trim())
}

function isShowCartRequest(message: string): boolean {
  return /^(warenkorb|cart|show cart)$/i.test(message.trim())
}

function looksLikeBroadCategoryRequest(message: string): boolean {
  return /\b(kategorien|kategorie|milchprodukte|kaese|käse|fleisch|getraenke|getränke|putzmittel|reinigungsmittel|baby|brot|gemuese|gemüse|pasta|reis|fruehstuck|frühstück)\b/i.test(message)
}

function isAdditiveCategoryRequest(message: string): boolean {
  return /\b(auch|noch|zusaetzlich|zusätzlich|plus)\b/i.test(message) ||
    looksLikeBroadCategoryRequest(message)
}

function isExplicitReplaceOrNarrowRequest(message: string): boolean {
  return /\b(nur|statt|ersetze|tausche|umstellen|reduziere)\b/i.test(message)
}

function inferSelectionMode(message: string, snapshot: ConversationSnapshot): "replace_with_single_product" | "add_to_existing_cart" {
  if (isExplicitReplaceOrNarrowRequest(message)) {
    return "replace_with_single_product"
  }
  const hasExistingCart = Boolean(snapshot.profile?.currentCartSnapshot?.items?.length)
  if (/\b(auch|noch|zusaetzlich|zusätzlich|plus)\b/i.test(message)) return "add_to_existing_cart"
  if (hasExistingCart && looksLikeBroadCategoryRequest(message)) return "add_to_existing_cart"
  return "replace_with_single_product"
}

function isMoreRequest(message: string): boolean {
  return /^(mehr|noch mehr|gibt es mehr|gibt es noch mehr|mehr kategorien|mehr davon|show more)$/i.test(message.trim())
}

function extractLeadingQuantity(message: string): number | null {
  const match = String(message || "").trim().match(/^(\d{1,3})$/)
  if (!match?.[1]) return null
  const parsed = Math.trunc(Number(match[1]))
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

function normalize(value: string): string {
  return String(value || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\w\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

function matchesCartItem(item: unknown, product: StoredAlfiesProduct): boolean {
  if (!item || typeof item !== "object") return false
  const row = item as Record<string, unknown>
  return (typeof row.product_id === "number" && Math.trunc(row.product_id) === product.product_id) ||
    (typeof row.sku === "string" && row.sku === (product.slug || String(product.product_id))) ||
    normalize(String(row.name || row.title || "")) === normalize(product.title)
}

function mergeDuplicateItems(items: unknown[]): unknown[] {
  const merged = new Map<string, Record<string, unknown>>()
  for (const item of items) {
    if (!item || typeof item !== "object") continue
    const row = { ...(item as Record<string, unknown>) }
    const key = String(row.sku || row.product_id || row.name || row.title || randomUUID())
    const current = merged.get(key)
    if (!current) {
      merged.set(key, row)
      continue
    }
    current.qty = Math.trunc(Number(current.qty || 0)) + Math.trunc(Number(row.qty || 0))
  }
  return [...merged.values()]
}
