import { mkdir, readFile, writeFile } from "node:fs/promises"
import { dirname } from "node:path"

export type StoredTelegramChannelLink = {
  telegram_user_id: string
  telegram_username?: string
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
  updated_at: string
}

type PersistedState = {
  channelLinks: Record<string, StoredTelegramChannelLink>
}

export class TelegramLinkStore {
  constructor(private readonly filePath: string) {}

  async getChannelLink(telegramUserId: string): Promise<StoredTelegramChannelLink | null> {
    const state = await this.readAll()
    return state.channelLinks[telegramUserId] ?? null
  }

  async upsertChannelLink(
    telegramUserId: string,
    patch: Partial<StoredTelegramChannelLink>,
  ): Promise<StoredTelegramChannelLink> {
    const state = await this.readAll()
    const current = state.channelLinks[telegramUserId]
    const now = new Date().toISOString()
    const nextStatus = patch.status ?? current?.status ?? "linked"
    const linkedAt = patch.linked_at ?? current?.linked_at ?? now

    const merged: StoredTelegramChannelLink = {
      telegram_user_id: patch.telegram_user_id ?? current?.telegram_user_id ?? telegramUserId,
      telegram_username: patch.telegram_username ?? current?.telegram_username,
      tenant_id: patch.tenant_id ?? current?.tenant_id,
      channel_app_id: patch.channel_app_id ?? current?.channel_app_id ?? "telegram_main",
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
      updated_at: now,
    }

    if (!merged.telegram_user_id.trim()) throw new Error("state_telegram_user_id_required")
    if (!merged.channel_app_id.trim()) throw new Error("state_channel_app_id_required")
    if (!merged.status.trim()) throw new Error("state_channel_link_status_required")

    state.channelLinks[telegramUserId] = merged
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
