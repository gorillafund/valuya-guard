import { mkdir, readFile, writeFile } from "node:fs/promises"
import { dirname } from "node:path"

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
  orderLinks: Record<string, StoredMarketplaceOrderLink>
}

export class MarketplaceOrderStore {
  private readonly filePath: string

  constructor(filePath: string) {
    this.filePath = filePath
  }

  async get(localOrderId: string): Promise<StoredMarketplaceOrderLink | null> {
    const state = await this.readAll()
    return state.orderLinks[localOrderId] ?? null
  }

  async upsert(
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

    state.orderLinks[localOrderId] = merged
    await this.writeAll(state)
    return merged
  }

  private async readAll(): Promise<PersistedState> {
    try {
      const raw = await readFile(this.filePath, "utf8")
      const parsed = JSON.parse(raw) as PersistedState
      return { orderLinks: parsed?.orderLinks ?? {} }
    } catch {
      return { orderLinks: {} }
    }
  }

  private async writeAll(state: PersistedState): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true })
    await writeFile(this.filePath, JSON.stringify(state, null, 2), "utf8")
  }
}
