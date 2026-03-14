import { mkdir, readFile, writeFile } from "node:fs/promises"
import { dirname } from "node:path"

export type StoredMarketplaceOrderLink = {
  local_order_id: string
  valuya_order_id: string
  checkout_url?: string
  guard_subject_id?: string
  guard_subject_type?: string
  guard_subject_external_id?: string
  protocol_subject_header: string
  amount_cents: number
  currency: string
  status?: string
  external_order_id?: string
  external_order_status?: string
  submitted_at?: string
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

  async getLatestByProtocolSubject(
    protocolSubjectHeader: string,
  ): Promise<StoredMarketplaceOrderLink | null> {
    const subjectHeader = String(protocolSubjectHeader || "").trim()
    if (!subjectHeader) return null
    const state = await this.readAll()
    const matches = Object.values(state.orderLinks)
      .filter((entry) => entry.protocol_subject_header === subjectHeader)
      .sort((a, b) => {
        const left = Date.parse(a.updated_at || "")
        const right = Date.parse(b.updated_at || "")
        return Number.isFinite(right) && Number.isFinite(left) ? right - left : 0
      })
    return matches[0] ?? null
  }

  async upsert(
    localOrderId: string,
    patch: Omit<StoredMarketplaceOrderLink, "local_order_id" | "updated_at">,
  ): Promise<StoredMarketplaceOrderLink> {
    const state = await this.readAll()
    const current = state.orderLinks[localOrderId]
    const merged: StoredMarketplaceOrderLink = {
      local_order_id: localOrderId,
      valuya_order_id:
        String(patch.valuya_order_id || current?.valuya_order_id || "").trim(),
      checkout_url:
        String(patch.checkout_url || current?.checkout_url || "").trim() || undefined,
      guard_subject_id: patch.guard_subject_id ?? current?.guard_subject_id,
      guard_subject_type: patch.guard_subject_type ?? current?.guard_subject_type,
      guard_subject_external_id:
        patch.guard_subject_external_id ?? current?.guard_subject_external_id,
      protocol_subject_header:
        String(patch.protocol_subject_header || current?.protocol_subject_header || "").trim(),
      amount_cents: Math.trunc(Number(patch.amount_cents || current?.amount_cents || 0)),
      currency: String(patch.currency || current?.currency || "").trim() || "EUR",
      status: patch.status ?? current?.status,
      external_order_id: patch.external_order_id ?? current?.external_order_id,
      external_order_status:
        patch.external_order_status ?? current?.external_order_status,
      submitted_at: patch.submitted_at ?? current?.submitted_at,
      updated_at: new Date().toISOString(),
    }

    if (!merged.valuya_order_id) throw new Error("marketplace_order_id_required")
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
