import type { CartStatePort } from "../ports/CartStatePort.js"
import type { CatalogPort } from "../ports/CatalogPort.js"
import type { CartMutationPort } from "../ports/CartMutationPort.js"
import type { ToolRegistry } from "../ports/ToolRegistry.js"
import type { AlfiesCheckoutPort } from "../ports/AlfiesCheckoutPort.js"
import type { PaymentGateway } from "../ports/PaymentGateway.js"

export class CommerceToolRegistry implements ToolRegistry {
  constructor(private readonly deps: {
    cartStatePort: CartStatePort
    catalogPort: CatalogPort
    cartMutationPort: CartMutationPort
    paymentGateway: PaymentGateway
    alfiesCheckout: AlfiesCheckoutPort
    defaultResource: string
    defaultPlan: string
  }) {}

  listTools() {
    return [
      { name: "cart.get_active", description: "Loads the active WhatsApp cart from shared conversation state." },
      { name: "catalog.resolve_product_query", description: "Resolves a shopper query to an Alfies product from the shared catalog." },
      { name: "catalog.browse_categories", description: "Returns matching Alfies categories for a browse query." },
      { name: "catalog.browse_products", description: "Returns matching Alfies products for a query or category." },
      { name: "catalog.recipe_to_products", description: "Maps a recipe-style request to likely Alfies products." },
      { name: "catalog.meal_candidates", description: "Builds grounded product candidate groups for a meal-style shopping request." },
      { name: "cart.add_bundle", description: "Adds a bundle of resolved Alfies products to the shared cart." },
      { name: "cart.add_item", description: "Adds a resolved product to the shared WhatsApp cart." },
      { name: "cart.remove_item", description: "Removes a resolved product from the shared WhatsApp cart." },
      { name: "cart.set_item_quantity", description: "Sets the quantity for a resolved product in the shared WhatsApp cart." },
      { name: "valuya.get_entitlement", description: "Checks whether the linked user is already entitled for Alfies checkout." },
      { name: "valuya.create_marketplace_order", description: "Creates a Valuya marketplace order for the current Alfies basket." },
      { name: "valuya.get_marketplace_order", description: "Loads marketplace order status and payment details such as on-chain transaction data." },
      { name: "valuya.request_delegated_payment", description: "Attempts delegated payment for the linked wallet." },
      { name: "valuya.create_checkout_link", description: "Creates a hosted checkout link for a Valuya marketplace order." },
      { name: "alfies.price_cart", description: "Calculates the payable total for the current Alfies cart." },
      { name: "alfies.prepare_checkout", description: "Prepares a real Alfies checkout snapshot with address and shipping options before payment." },
      { name: "alfies.submit_paid_order", description: "Submits the prepared Alfies order after payment is confirmed." },
      { name: "alfies.dispatch_order", description: "Dispatches the confirmed Alfies order to the backend order service." },
    ]
  }

  async executeTool({ call, linkedSubject }: Parameters<ToolRegistry["executeTool"]>[0]) {
    switch (call.name) {
      case "cart.get_active": {
        const result = await this.deps.cartStatePort.getActiveCart({
          whatsappUserId: readRequiredString(call.input.whatsappUserId, "tool_whatsapp_user_id_required"),
        })
        return {
          toolCallId: call.id,
          name: call.name,
          output: result || { found: false },
        }
      }
      case "catalog.resolve_product_query": {
        const result = await this.deps.catalogPort.resolveProductQuery({
          query: readRequiredString(call.input.query, "tool_product_query_required"),
        })
        return { toolCallId: call.id, name: call.name, output: result }
      }
      case "catalog.browse_categories": {
        const result = await this.deps.catalogPort.browseCategories({
          query: readString(call.input.query),
          page: readNumber(call.input.page) || 0,
          limit: readNumber(call.input.limit),
        })
        return { toolCallId: call.id, name: call.name, output: result }
      }
      case "catalog.browse_products": {
        const result = await this.deps.catalogPort.browseProducts({
          query: readString(call.input.query),
          category: readString(call.input.category),
          page: readNumber(call.input.page) || 0,
          limit: readNumber(call.input.limit),
        })
        return { toolCallId: call.id, name: call.name, output: result }
      }
      case "catalog.recipe_to_products": {
        const result = await this.deps.catalogPort.recipeToProducts({
          query: readRequiredString(call.input.query, "tool_recipe_query_required"),
        })
        return { toolCallId: call.id, name: call.name, output: result || { found: false } }
      }
      case "catalog.meal_candidates": {
        const result = await this.deps.catalogPort.buildMealCandidates({
          query: readRequiredString(call.input.query, "tool_recipe_query_required"),
        })
        return { toolCallId: call.id, name: call.name, output: result || { found: false } }
      }
      case "cart.add_bundle": {
        const productIds = Array.isArray(call.input.productIds)
          ? call.input.productIds.map((value) => readRequiredNumber(value, "tool_product_id_required"))
          : []
        const result = await this.deps.cartMutationPort.addBundle({
          whatsappUserId: readRequiredString(call.input.whatsappUserId, "tool_whatsapp_user_id_required"),
          productIds,
        })
        return { toolCallId: call.id, name: call.name, output: result }
      }
      case "cart.add_item": {
        const result = await this.deps.cartMutationPort.addProduct({
          whatsappUserId: readRequiredString(call.input.whatsappUserId, "tool_whatsapp_user_id_required"),
          productId: readRequiredNumber(call.input.productId, "tool_product_id_required"),
          quantity: readNumber(call.input.quantity) || 1,
        })
        return { toolCallId: call.id, name: call.name, output: result }
      }
      case "cart.remove_item": {
        const result = await this.deps.cartMutationPort.removeProduct({
          whatsappUserId: readRequiredString(call.input.whatsappUserId, "tool_whatsapp_user_id_required"),
          productId: readRequiredNumber(call.input.productId, "tool_product_id_required"),
        })
        return { toolCallId: call.id, name: call.name, output: result }
      }
      case "cart.set_item_quantity": {
        const result = await this.deps.cartMutationPort.setProductQuantity({
          whatsappUserId: readRequiredString(call.input.whatsappUserId, "tool_whatsapp_user_id_required"),
          productId: readRequiredNumber(call.input.productId, "tool_product_id_required"),
          quantity: readRequiredNumber(call.input.quantity, "tool_quantity_required"),
        })
        return { toolCallId: call.id, name: call.name, output: result }
      }
      case "valuya.get_entitlement": {
        const result = await this.deps.paymentGateway.getEntitlement({
          protocolSubjectHeader: linkedSubject.protocolSubjectHeader,
          resource: readString(call.input.resource) || this.deps.defaultResource,
          plan: readString(call.input.plan) || this.deps.defaultPlan,
        })
        return { toolCallId: call.id, name: call.name, output: result }
      }
      case "valuya.create_marketplace_order": {
        const amountCents = readNumber(call.input.amountCents)
        if (!amountCents) throw new Error("tool_amount_cents_required")
        const result = await this.deps.paymentGateway.createMarketplaceOrder({
          localOrderId: readRequiredString(call.input.localOrderId, "tool_local_order_id_required"),
          protocolSubjectHeader: linkedSubject.protocolSubjectHeader,
          guardSubjectId: linkedSubject.guardSubjectId,
          guardSubjectType: linkedSubject.guardSubjectType,
          guardSubjectExternalId: linkedSubject.guardSubjectExternalId,
          amountCents,
          currency: readString(call.input.currency) || "EUR",
          asset: readString(call.input.asset) || "EURe",
          cart: call.input.cart,
        })
        return { toolCallId: call.id, name: call.name, output: result }
      }
      case "valuya.get_marketplace_order": {
        const result = await this.deps.paymentGateway.getMarketplaceOrder({
          protocolSubjectHeader: linkedSubject.protocolSubjectHeader,
          orderId: readRequiredString(call.input.orderId, "tool_order_id_required"),
        })
        return { toolCallId: call.id, name: call.name, output: result }
      }
      case "valuya.request_delegated_payment": {
        const result = await this.deps.paymentGateway.requestDelegatedPayment({
          protocolSubjectHeader: linkedSubject.protocolSubjectHeader,
          guardSubjectId: linkedSubject.guardSubjectId,
          guardSubjectType: linkedSubject.guardSubjectType,
          guardSubjectExternalId: linkedSubject.guardSubjectExternalId,
          principalSubjectType: linkedSubject.subjectType || "whatsapp",
          principalSubjectId: linkedSubject.subjectId || readRequiredString(call.input.principalSubjectId, "tool_principal_subject_id_required"),
          walletAddress: linkedSubject.linkedWalletAddress || readRequiredString(call.input.walletAddress, "tool_wallet_address_required"),
          merchantOrderId: readString(call.input.merchantOrderId),
          amountCents: readNumber(call.input.amountCents),
          currency: readString(call.input.currency) || "EUR",
          asset: readString(call.input.asset) || "EURe",
          actorType: readString(call.input.actorType) || "agent",
          channel: readString(call.input.channel) || "whatsapp",
          scope: readString(call.input.scope) || "commerce.order",
          counterpartyType: readString(call.input.counterpartyType) || "merchant",
          counterpartyId: readString(call.input.counterpartyId) || "alfies",
          idempotencyKey: readRequiredString(call.input.idempotencyKey, "tool_idempotency_key_required"),
          cart: call.input.cart,
        })
        return { toolCallId: call.id, name: call.name, output: result }
      }
      case "valuya.create_checkout_link": {
        const result = await this.deps.paymentGateway.createCheckoutLink({
          protocolSubjectHeader: linkedSubject.protocolSubjectHeader,
          orderId: readRequiredString(call.input.orderId, "tool_order_id_required"),
        })
        return { toolCallId: call.id, name: call.name, output: result }
      }
      case "alfies.price_cart": {
        const lines = readCartLines(call.input.lines)
        const result = await this.deps.alfiesCheckout.priceCart({ lines })
        return { toolCallId: call.id, name: call.name, output: result }
      }
      case "alfies.prepare_checkout": {
        const result = await this.deps.alfiesCheckout.prepareCheckout({
          localOrderId: readRequiredString(call.input.localOrderId, "tool_local_order_id_required"),
          protocolSubjectHeader: linkedSubject.protocolSubjectHeader,
          lines: readCartLines(call.input.lines),
          deliveryAddress: readDeliveryAddress(call.input.deliveryAddress),
          shippingDate: readRequiredString(call.input.shippingDate, "tool_shipping_date_required"),
          deliveryNote: readString(call.input.deliveryNote),
          phone: readString(call.input.phone),
        })
        return { toolCallId: call.id, name: call.name, output: result }
      }
      case "alfies.submit_paid_order": {
        const result = await this.deps.alfiesCheckout.submitPaidOrder({
          localOrderId: readRequiredString(call.input.localOrderId, "tool_local_order_id_required"),
          protocolSubjectHeader: linkedSubject.protocolSubjectHeader,
          paymentReference: readRequiredString(call.input.paymentReference, "tool_payment_reference_required"),
          lines: readCartLines(call.input.lines),
          deliveryAddress: readDeliveryAddress(call.input.deliveryAddress),
          billingAddress: call.input.billingAddress ? readDeliveryAddress(call.input.billingAddress) : undefined,
          shippingOption: readShippingOption(call.input.shippingOption),
          expectedTotalCents: readRequiredNumber(call.input.expectedTotalCents, "tool_expected_total_cents_required"),
        })
        return { toolCallId: call.id, name: call.name, output: result }
      }
      case "alfies.dispatch_order": {
        const result = await this.deps.alfiesCheckout.dispatchOrder({
          localOrderId: readRequiredString(call.input.localOrderId, "tool_local_order_id_required"),
          protocolSubjectHeader: linkedSubject.protocolSubjectHeader,
          lines: readCartLines(call.input.lines),
        })
        return { toolCallId: call.id, name: call.name, output: result }
      }
      default:
        throw new Error(`unknown_tool:${call.name}`)
    }
  }
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined
}

function readRequiredString(value: unknown, code: string): string {
  const result = readString(value)
  if (!result) throw new Error(code)
  return result
}

function readRequiredNumber(value: unknown, code: string): number {
  const result = readNumber(value)
  if (typeof result !== "number") throw new Error(code)
  return result
}

function readNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return Math.trunc(value)
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return Math.trunc(parsed)
  }
  return undefined
}

function readCartLines(value: unknown) {
  if (!Array.isArray(value)) return []
  return value
    .map((line) => {
      if (!line || typeof line !== "object") return null
      const record = line as Record<string, unknown>
      const sku = readRequiredString(record.sku, "tool_cart_line_sku_required")
      const name = readRequiredString(record.name, "tool_cart_line_name_required")
      const qty = readNumber(record.qty) || 1
      return {
        ...(typeof readNumber(record.productId ?? record.product_id) === "number"
          ? { productId: readNumber(record.productId ?? record.product_id) }
          : {}),
        sku,
        name,
        qty,
        unitPriceCents: readNumber(record.unitPriceCents ?? record.unit_price_cents),
      }
    })
    .filter((line): line is NonNullable<typeof line> => Boolean(line))
}

function readDeliveryAddress(value: unknown) {
  if (!value || typeof value !== "object") throw new Error("tool_delivery_address_required")
  const record = value as Record<string, unknown>
  const latitude = readNumber(record.latitude)
  const longitude = readNumber(record.longitude)
  if (typeof latitude !== "number" || typeof longitude !== "number") {
    throw new Error("tool_delivery_address_coordinates_required")
  }
  return {
    line1: readRequiredString(record.line1, "tool_delivery_address_line1_required"),
    house: readRequiredString(record.house, "tool_delivery_address_house_required"),
    postcode: readRequiredString(record.postcode, "tool_delivery_address_postcode_required"),
    city: readRequiredString(record.city, "tool_delivery_address_city_required"),
    latitude,
    longitude,
    ...(readString(record.phone) ? { phone: readString(record.phone) } : {}),
    ...(readString(record.notes) ? { notes: readString(record.notes) } : {}),
  }
}

function readShippingOption(value: unknown) {
  if (!value || typeof value !== "object") throw new Error("tool_shipping_option_required")
  const record = value as Record<string, unknown>
  return {
    code: readRequiredString(record.code, "tool_shipping_option_code_required"),
    ...(readString(record.date) ? { date: readString(record.date) } : {}),
    ...(readString(record.name) ? { name: readString(record.name) } : {}),
    ...(typeof readNumber(record.shippingChargeCents ?? record.shipping_charge_cents) === "number"
      ? { shippingChargeCents: readNumber(record.shippingChargeCents ?? record.shipping_charge_cents) }
      : {}),
    ...(readString(record.currency) ? { currency: readString(record.currency) } : {}),
    raw: record,
  }
}
