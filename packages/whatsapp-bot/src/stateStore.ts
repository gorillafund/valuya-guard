import { mkdir, readFile, writeFile } from "node:fs/promises"
import { dirname } from "node:path"

export type CartState = {
  items?: unknown[]
  total_cents?: number
  currency?: string
}

export type RecipeState = {
  title?: string
}

export type ConversationState = {
  subjectId: string
  orderId: string
  lastRecipe?: RecipeState
  lastCart?: CartState
  updatedAt: string
}

export type StoredChannelLink = {
  whatsapp_user_id: string
  whatsapp_profile_name?: string
  tenant_id?: string
  channel_app_id: string
  valuya_subject_id?: string
  valuya_subject_type?: string
  valuya_subject_external_id?: string
  valuya_privy_user_id?: string
  valuya_linked_wallet_address?: string
  valuya_privy_wallet_id?: string
  valuya_protocol_subject_type?: string
  valuya_protocol_subject_id?: string
  valuya_protocol_subject_header?: string
  status: string
  linked_at: string
  meta?: Record<string, unknown>
  updated_at: string
}

export type StoredMarketplaceOrderLink = {
  local_order_id: string
  valuya_order_id: string
  checkout_url: string
  guard_subject_id?: string
  guard_subject_type?: string
  guard_subject_external_id?: string
  protocol_subject_header: string
  amount_cents: number
  currency: string
  status?: string
  updated_at: string
}

type PersistedState = {
  conversations: Record<string, ConversationState>
  channelLinks: Record<string, StoredChannelLink>
  marketplaceOrderLinks: Record<string, StoredMarketplaceOrderLink>
}

export class FileStateStore {
  private readonly filePath: string

  constructor(filePath: string) {
    this.filePath = filePath
  }

  async get(subjectId: string): Promise<ConversationState | null> {
    const state = await this.readAll()
    return state.conversations[subjectId] ?? null
  }

  async upsert(subjectId: string, patch: Partial<ConversationState>): Promise<ConversationState> {
    const state = await this.readAll()
    const current = state.conversations[subjectId]
    const merged: ConversationState = {
      subjectId,
      orderId: patch.orderId ?? current?.orderId ?? "",
      lastRecipe: patch.lastRecipe ?? current?.lastRecipe,
      lastCart: patch.lastCart ?? current?.lastCart,
      updatedAt: new Date().toISOString(),
    }

    if (!merged.orderId.trim()) {
      throw new Error("state_order_id_required")
    }

    state.conversations[subjectId] = merged
    await this.writeAll(state)
    return merged
  }

  async delete(subjectId: string): Promise<void> {
    const state = await this.readAll()
    if (state.conversations[subjectId]) {
      delete state.conversations[subjectId]
      await this.writeAll(state)
    }
  }

  async getChannelLink(whatsappUserId: string): Promise<StoredChannelLink | null> {
    const state = await this.readAll()
    return state.channelLinks[whatsappUserId] ?? null
  }

  async upsertChannelLink(whatsappUserId: string, patch: Partial<StoredChannelLink>): Promise<StoredChannelLink> {
    const state = await this.readAll()
    const current = state.channelLinks[whatsappUserId]
    const now = new Date().toISOString()
    const nextStatus = patch.status ?? current?.status ?? "linked"
    const linkedAt = patch.linked_at ?? current?.linked_at ?? now

    const merged: StoredChannelLink = {
      whatsapp_user_id: patch.whatsapp_user_id ?? current?.whatsapp_user_id ?? whatsappUserId,
      whatsapp_profile_name: patch.whatsapp_profile_name ?? current?.whatsapp_profile_name,
      tenant_id: patch.tenant_id ?? current?.tenant_id,
      channel_app_id: patch.channel_app_id ?? current?.channel_app_id ?? "whatsapp_main",
      valuya_subject_id: patch.valuya_subject_id ?? current?.valuya_subject_id,
      valuya_subject_type: patch.valuya_subject_type ?? current?.valuya_subject_type,
      valuya_subject_external_id: patch.valuya_subject_external_id ?? current?.valuya_subject_external_id,
      valuya_privy_user_id: patch.valuya_privy_user_id ?? current?.valuya_privy_user_id,
      valuya_linked_wallet_address: patch.valuya_linked_wallet_address ?? current?.valuya_linked_wallet_address,
      valuya_privy_wallet_id: patch.valuya_privy_wallet_id ?? current?.valuya_privy_wallet_id,
      valuya_protocol_subject_type:
        patch.valuya_protocol_subject_type ?? current?.valuya_protocol_subject_type,
      valuya_protocol_subject_id:
        patch.valuya_protocol_subject_id ?? current?.valuya_protocol_subject_id,
      valuya_protocol_subject_header:
        patch.valuya_protocol_subject_header ?? current?.valuya_protocol_subject_header,
      status: nextStatus,
      linked_at: linkedAt,
      meta: patch.meta ? { ...(current?.meta || {}), ...patch.meta } : current?.meta,
      updated_at: now,
    }

    if (!merged.whatsapp_user_id.trim()) throw new Error("state_whatsapp_user_id_required")
    if (!merged.channel_app_id.trim()) throw new Error("state_channel_app_id_required")
    if (!merged.status.trim()) throw new Error("state_channel_link_status_required")

    state.channelLinks[whatsappUserId] = merged
    await this.writeAll(state)
    return merged
  }

  async upsertMarketplaceOrderLink(
    localOrderId: string,
    patch: Omit<StoredMarketplaceOrderLink, "local_order_id" | "updated_at">,
  ): Promise<StoredMarketplaceOrderLink> {
    const state = await this.readAll()
    const merged: StoredMarketplaceOrderLink = {
      local_order_id: localOrderId,
      valuya_order_id: String(patch.valuya_order_id || "").trim(),
      checkout_url: String(patch.checkout_url || "").trim(),
      guard_subject_id: patch.guard_subject_id,
      guard_subject_type: patch.guard_subject_type,
      guard_subject_external_id: patch.guard_subject_external_id,
      protocol_subject_header: String(patch.protocol_subject_header || "").trim(),
      amount_cents: Math.trunc(Number(patch.amount_cents || 0)),
      currency: String(patch.currency || "").trim() || "EUR",
      status: patch.status,
      updated_at: new Date().toISOString(),
    }

    if (!merged.valuya_order_id) throw new Error("marketplace_order_id_required")
    if (!merged.checkout_url) throw new Error("marketplace_checkout_url_required")
    if (!merged.protocol_subject_header) throw new Error("marketplace_protocol_subject_required")
    if (!Number.isFinite(merged.amount_cents) || merged.amount_cents <= 0) {
      throw new Error("marketplace_amount_required")
    }

    state.marketplaceOrderLinks[localOrderId] = merged
    await this.writeAll(state)
    return merged
  }

  private async readAll(): Promise<PersistedState> {
    try {
      const raw = await readFile(this.filePath, "utf8")
      const parsed = JSON.parse(raw) as PersistedState
      return {
        conversations: parsed?.conversations ?? {},
        channelLinks: parsed?.channelLinks ?? {},
        marketplaceOrderLinks: parsed?.marketplaceOrderLinks ?? {},
      }
    } catch {
      return { conversations: {}, channelLinks: {}, marketplaceOrderLinks: {} }
    }
  }

  private async writeAll(state: PersistedState): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true })
    await writeFile(this.filePath, JSON.stringify(state, null, 2), "utf8")
  }
}

export function normalizeCart(input: unknown): CartState | undefined {
  if (!input || typeof input !== "object") return undefined
  const obj = input as Record<string, unknown>

  const cart: CartState = {}
  if (Array.isArray(obj.items)) cart.items = obj.items

  const total = toInt(obj.total_cents)
  if (typeof total === "number") cart.total_cents = total

  const currency = String(obj.currency ?? "").trim()
  if (currency) cart.currency = currency

  return Object.keys(cart).length > 0 ? cart : undefined
}

export function normalizeRecipe(input: unknown): RecipeState | undefined {
  if (!input || typeof input !== "object") return undefined
  const title = String((input as Record<string, unknown>).title ?? "").trim()
  return title ? { title } : undefined
}

function toInt(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return Math.trunc(value)
  if (typeof value === "string" && value.trim()) {
    const n = Number(value)
    if (Number.isFinite(n)) return Math.trunc(n)
  }
  return undefined
}
