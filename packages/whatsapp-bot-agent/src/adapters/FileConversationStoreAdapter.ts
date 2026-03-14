import { readMarketplaceSessionState, writeMarketplaceSessionState } from "@valuya/marketplace-agent-core"
import { FileStateStore } from "../../../whatsapp-bot/dist/whatsapp-bot/src/stateStore.js"
import type { ConversationEntry, ConversationSession } from "../domain/types.js"
import type { ConversationStore } from "../ports/ConversationStore.js"

export class FileConversationStoreAdapter implements ConversationStore {
  private readonly store: FileStateStore

  constructor(stateFile: string, store?: FileStateStore) {
    this.store = store || new FileStateStore(stateFile)
  }

  async getOrCreateSession(args: { whatsappUserId: string }): Promise<ConversationSession> {
    const conversation = await this.store.get(args.whatsappUserId)
    const profile = await this.store.getProfile(args.whatsappUserId)
    const entries = (profile?.profile?.recentConversationHistory || [])
      .map(parseHistoryEntry)
      .filter((entry): entry is ConversationEntry => Boolean(entry))

    const marketplaceSession = readMarketplaceSessionState({
      resource: readMetadataString(profile?.profile?.extractedEntities, "agent_marketplace_resource"),
      plan: readMetadataString(profile?.profile?.extractedEntities, "agent_marketplace_plan"),
      currentMarketplaceOrderId: readMetadataString(profile?.profile?.extractedEntities, "agent_current_marketplace_order_id"),
      currentCheckoutUrl: readMetadataString(profile?.profile?.extractedEntities, "agent_current_checkout_url"),
      shippingDate: readMetadataString(profile?.profile?.extractedEntities, "agent_shipping_date"),
      deliveryNote: readMetadataString(profile?.profile?.extractedEntities, "agent_delivery_note"),
      phone: readMetadataString(profile?.profile?.extractedEntities, "agent_phone"),
      deliveryAddress:
        profile?.profile?.extractedEntities && typeof profile.profile.extractedEntities === "object"
          ? (profile.profile.extractedEntities as Record<string, unknown>).agent_delivery_address
          : undefined,
    })

    return {
      conversationId: `wa-agent:${args.whatsappUserId}`,
      whatsappUserId: args.whatsappUserId,
      entries,
      metadata: {
        marketplaceSession,
        currentOrderId: conversation?.orderId,
        currentCartSnapshot: profile?.profile?.currentCartSnapshot ?? conversation?.lastCart,
        selectedRecipeTitle: profile?.profile?.selectedRecipeTitle ?? conversation?.lastRecipe?.title,
        pendingProductOptions: profile?.profile?.pendingOptions?.kind === "product_selection"
          ? profile.profile.pendingOptions.options.map((option) => ({
              id: option.id,
              label: option.label,
              value: option.value,
              productId: option.productId,
              sku: option.sku,
              unitPriceCents: option.unitPriceCents,
              currency: option.currency,
            }))
          : undefined,
        pendingProductPrompt: profile?.profile?.pendingOptions?.kind === "product_selection"
          ? profile.profile.pendingOptions.prompt
          : undefined,
        pendingMutation: readMetadataString(profile?.profile?.extractedEntities, "agent_pending_mutation"),
        pendingBrowseType: readMetadataString(profile?.profile?.extractedEntities, "agent_pending_browse_type"),
        pendingQuantity: readOptionalNumber(
          profile?.profile?.extractedEntities && typeof profile.profile.extractedEntities === "object"
            ? (profile.profile.extractedEntities as Record<string, unknown>).agent_pending_quantity
            : undefined,
        ),
        pendingBundleProductIds: readOptionalNumberList(
          profile?.profile?.extractedEntities && typeof profile.profile.extractedEntities === "object"
            ? (profile.profile.extractedEntities as Record<string, unknown>).agent_pending_bundle_product_ids
            : undefined,
        ),
        pendingRecipeTitle: readMetadataString(profile?.profile?.extractedEntities, "agent_pending_recipe_title"),
        pendingRecipeQuery: readMetadataString(profile?.profile?.extractedEntities, "agent_pending_recipe_query"),
        pendingBrowseQuery: readMetadataString(profile?.profile?.extractedEntities, "agent_pending_browse_query"),
        pendingBrowseCategory: readMetadataString(profile?.profile?.extractedEntities, "agent_pending_browse_category"),
        pendingBrowsePage: readOptionalNumber(
          profile?.profile?.extractedEntities && typeof profile.profile.extractedEntities === "object"
            ? (profile.profile.extractedEntities as Record<string, unknown>).agent_pending_browse_page
            : undefined,
        ),
        lastShoppingKind: readMetadataString(profile?.profile?.extractedEntities, "agent_last_shopping_kind"),
        lastShoppingQuery: readMetadataString(profile?.profile?.extractedEntities, "agent_last_shopping_query"),
        currentMarketplaceOrderId: marketplaceSession.marketplaceOrderId,
        currentCheckoutUrl: marketplaceSession.checkoutUrl,
        resource: marketplaceSession.resource,
        plan: marketplaceSession.plan,
        shippingDate: marketplaceSession.shippingDate,
        deliveryAddress: marketplaceSession.deliveryAddress,
        deliveryNote: marketplaceSession.deliveryNote,
        phone: marketplaceSession.phone,
        onboardingStage: profile?.onboardingStage,
        updatedAt: profile?.updatedAt,
      },
    }
  }

  async saveSession(session: ConversationSession): Promise<void> {
    const marketplaceSession = readMarketplaceSessionState(session.metadata)
    const nextMetadata = writeMarketplaceSessionState({
      metadata: session.metadata,
      session: marketplaceSession,
    })
    const pendingProductOptions = Array.isArray(session.metadata?.pendingProductOptions)
      ? session.metadata?.pendingProductOptions as Array<Record<string, unknown>>
      : undefined
    await this.store.upsertProfile(session.whatsappUserId, {
      onboardingStage: "guided",
      profile: {
        latestMessage: session.entries.at(-1)?.content,
        recentConversationHistory: serializeConversationHistory(session.entries),
        extractedEntities: {
          agent_pending_mutation: readOptionalString(session.metadata?.pendingMutation),
          agent_pending_browse_type: readOptionalString(session.metadata?.pendingBrowseType),
          agent_pending_quantity: readOptionalNumber(session.metadata?.pendingQuantity),
          agent_pending_bundle_product_ids: Array.isArray(session.metadata?.pendingBundleProductIds)
            ? session.metadata?.pendingBundleProductIds
            : undefined,
          agent_pending_recipe_title: readOptionalString(session.metadata?.pendingRecipeTitle),
          agent_pending_recipe_query: readOptionalString(session.metadata?.pendingRecipeQuery),
          agent_pending_browse_query: readOptionalString(session.metadata?.pendingBrowseQuery),
          agent_pending_browse_category: readOptionalString(session.metadata?.pendingBrowseCategory),
          agent_pending_browse_page: readOptionalNumber(session.metadata?.pendingBrowsePage),
          agent_last_shopping_kind: readOptionalString(session.metadata?.lastShoppingKind),
          agent_last_shopping_query: readOptionalString(session.metadata?.lastShoppingQuery),
          agent_marketplace_resource: readOptionalString(nextMetadata.resource),
          agent_marketplace_plan: readOptionalString(nextMetadata.plan),
          agent_current_marketplace_order_id: readOptionalString(nextMetadata.currentMarketplaceOrderId),
          agent_current_checkout_url: readOptionalString(nextMetadata.currentCheckoutUrl),
          agent_shipping_date: readOptionalString(nextMetadata.shippingDate),
          agent_delivery_note: readOptionalString(nextMetadata.deliveryNote),
          agent_phone: readOptionalString(nextMetadata.phone),
          agent_delivery_address:
            nextMetadata.deliveryAddress && typeof nextMetadata.deliveryAddress === "object"
              ? nextMetadata.deliveryAddress
              : undefined,
        },
        pendingOptions: pendingProductOptions?.length
          ? {
              kind: "product_selection",
              prompt: readOptionalString(session.metadata?.pendingProductPrompt) || "Welche Variante meinst du?",
              options: pendingProductOptions.map((option, index) => ({
                id: readOptionalString(option.id) || `agent_option_${index + 1}`,
                label: readOptionalString(option.label) || readOptionalString(option.value) || `Option ${index + 1}`,
                value: readOptionalString(option.value) || readOptionalString(option.label) || `Option ${index + 1}`,
                productId: readOptionalNumber(option.productId),
                sku: readOptionalString(option.sku),
                unitPriceCents: readOptionalNumber(option.unitPriceCents),
                currency: readOptionalString(option.currency),
              })),
            }
          : undefined,
      },
    })
  }
}

function parseHistoryEntry(raw: string): ConversationEntry | null {
  const value = String(raw || "").trim()
  if (!value) return null

  const toolMatch = /^tool(?:\[(?<toolCallId>[^\]]+)\])?(?:\[(?<name>[^\]]+)\])?:\s*(?<content>.*)$/s.exec(value)
  if (toolMatch?.groups?.content !== undefined) {
    return {
      role: "tool",
      content: toolMatch.groups.content,
      toolCallId: toolMatch.groups.toolCallId,
      name: toolMatch.groups.name,
      createdAt: new Date(0).toISOString(),
    }
  }

  const roleMatch = /^(user|assistant):\s*(.*)$/s.exec(value)
  if (!roleMatch) return null
  return {
    role: roleMatch[1] as "user" | "assistant",
    content: roleMatch[2] || "",
    createdAt: new Date(0).toISOString(),
  }
}

function formatHistoryEntry(entry: ConversationEntry): string {
  if (entry.role === "tool") {
    const parts = ["tool"]
    if (entry.toolCallId) parts.push(`[${entry.toolCallId}]`)
    if (entry.name) parts.push(`[${entry.name}]`)
    return `${parts.join("")}: ${entry.content}`
  }
  return `${entry.role}: ${entry.content}`
}

function serializeConversationHistory(entries: ConversationEntry[]): string[] {
  return entries
    .filter((entry) => entry.role === "user" || entry.role === "assistant")
    .slice(-24)
    .map((entry) => ({
      ...entry,
      content: clampHistoryContent(entry.content),
    }))
    .map(formatHistoryEntry)
}

function clampHistoryContent(value: string): string {
  const normalized = String(value || "").replace(/\r\n/g, "\n").trim()
  if (normalized.length <= 500) return normalized
  return `${normalized.slice(0, 497).trimEnd()}...`
}

function readOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined
}

function readOptionalNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return Math.trunc(value)
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return Math.trunc(parsed)
  }
  return undefined
}

function readMetadataString(record: unknown, key: string): string | undefined {
  if (!record || typeof record !== "object") return undefined
  return readOptionalString((record as Record<string, unknown>)[key])
}

function readOptionalNumberList(value: unknown): number[] | undefined {
  if (!Array.isArray(value)) return undefined
  const result = value
    .map((entry) => readOptionalNumber(entry))
    .filter((entry): entry is number => typeof entry === "number")
  return result.length ? result : undefined
}
