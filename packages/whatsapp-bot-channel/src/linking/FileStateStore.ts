import { mkdir, readFile, writeFile } from "node:fs/promises"
import { dirname } from "node:path"

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

type PersistedState = {
  channelLinks: Record<string, StoredChannelLink>
}

export class FileStateStore {
  constructor(private readonly filePath: string) {}

  async getChannelLink(whatsappUserId: string): Promise<StoredChannelLink | null> {
    const state = await this.readAll()
    return state.channelLinks[whatsappUserId] ?? null
  }

  async upsertChannelLink(whatsappUserId: string, patch: Partial<StoredChannelLink>): Promise<StoredChannelLink> {
    const state = await this.readAll()
    const current = state.channelLinks[whatsappUserId]
    const now = new Date().toISOString()

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
      status: patch.status ?? current?.status ?? "linked",
      linked_at: patch.linked_at ?? current?.linked_at ?? now,
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

  private async readAll(): Promise<PersistedState> {
    try {
      const raw = await readFile(this.filePath, "utf8")
      const parsed = JSON.parse(raw) as PersistedState
      return { channelLinks: parsed?.channelLinks ?? {} }
    } catch {
      return { channelLinks: {} }
    }
  }

  private async writeAll(state: PersistedState): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true })
    await writeFile(this.filePath, JSON.stringify(state, null, 2), "utf8")
  }
}
