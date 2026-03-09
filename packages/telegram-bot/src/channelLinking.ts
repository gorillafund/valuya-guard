import type { TelegramLinkStore, StoredTelegramChannelLink } from "./linkStore.js"

export type LinkErrorCode =
  | "invalid_token"
  | "token_expired"
  | "token_already_used"
  | "tenant_mismatch"
  | "not_linked"
  | "guard_unavailable"

export type LinkedValuyaSubject = {
  type: string
  externalId: string
  subjectId?: string
  privyUserId?: string
  linkedWalletAddress?: string
}

export type LinkResult =
  | {
      linked: true
      source: "redeem" | "resolve" | "resolve_after_redeem_failure" | "local_cache"
      subject: LinkedValuyaSubject
      link: StoredTelegramChannelLink
    }
  | {
      linked: false
      code: LinkErrorCode
      message: string
    }

type GuardLinkSubject = {
  type?: string
  external_id?: string
}

type GuardChannelLink = {
  id?: number | string
  status?: string
  tenant_id?: number | string
  channel_app_id?: string
  channel_user_id?: string
  subject_id?: number | string
  subject?: GuardLinkSubject
  privy_user_id?: string
  wallet_address?: string
  privy_wallet_id?: string
  protocol_subject?: {
    type?: string
    id?: string | number
    header?: string
  } | null
}

type GuardEnvelope = {
  ok?: boolean
  link?: GuardChannelLink | null
  error?: string
  code?: string
  message?: string
}

type LogFn = (event: string, fields: Record<string, unknown>) => void

export class GuardTelegramLinkService {
  private readonly baseUrl: string
  private readonly tenantToken: string
  private readonly channelAppId: string
  private readonly redeemedFrom: string
  private readonly linkStore: TelegramLinkStore
  private readonly log: LogFn

  constructor(args: {
    baseUrl: string
    tenantToken: string
    channelAppId: string
    linkStore: TelegramLinkStore
    redeemedFrom?: string
    logger?: LogFn
  }) {
    this.baseUrl = args.baseUrl.replace(/\/+$/, "")
    this.tenantToken = args.tenantToken
    this.channelAppId = args.channelAppId
    this.linkStore = args.linkStore
    this.redeemedFrom = args.redeemedFrom?.trim() || "telegram_bot"
    this.log =
      args.logger ||
      ((event, fields) => {
        console.log(JSON.stringify({ level: "info", event, ...fields }))
      })
  }

  async redeemLinkToken(args: {
    telegramUserId: string
    linkToken: string
    telegramUsername?: string
  }): Promise<LinkResult> {
    const telegramUserId = normalizeTelegramUserId(args.telegramUserId)
    const linkToken = String(args.linkToken || "").trim()

    this.log("guard_telegram_redeem_request", {
      tenant: tenantRef(this.tenantToken),
      hasLinkToken: Boolean(linkToken),
      linkTokenPrefix: linkToken ? linkToken.slice(0, 8) : null,
      channel_user_id: telegramUserId,
      username: cleanOptional(args.telegramUsername) || null,
      channel_app_id_config: this.channelAppId,
      redeemed_from: this.redeemedFrom,
    })

    if (!linkToken) {
      return {
        linked: false,
        code: "invalid_token",
        message: "Invalid link token. Please use the latest onboarding link.",
      }
    }

    try {
      const env = await this.post("guard_telegram_redeem_response", "/api/guard/channels/telegram/redeem", {
        link_token: linkToken,
        channel_user_id: telegramUserId,
        channel_username: cleanOptional(args.telegramUsername),
        redeemed_from: this.redeemedFrom,
      })

      const persisted = await this.persistLink(telegramUserId, args.telegramUsername, env.link)
      this.logPersistResult("redeem", telegramUserId, persisted)
      if (!persisted) {
        return {
          linked: false,
          code: "guard_unavailable",
          message: "Could not confirm link result. Please try again.",
        }
      }

      return {
        linked: true,
        source: "redeem",
        subject: toLinkedSubject(persisted),
        link: persisted,
      }
    } catch (error) {
      const guardError = toGuardError(error)
      if (guardError.code === "token_already_used") {
        const resolved = await this.resolveLinkedSubject({
          telegramUserId,
          telegramUsername: args.telegramUsername,
        })
        if (resolved.linked) {
          return {
            linked: true,
            source: "resolve_after_redeem_failure",
            subject: resolved.subject,
            link: resolved.link,
          }
        }
      }

      return {
        linked: false,
        code: guardError.code,
        message: guardError.message,
      }
    }
  }

  async resolveLinkedSubject(args: {
    telegramUserId: string
    telegramUsername?: string
  }): Promise<LinkResult> {
    const telegramUserId = normalizeTelegramUserId(args.telegramUserId)

    this.log("guard_telegram_resolve_request", {
      tenant: tenantRef(this.tenantToken),
      channel_user_id: telegramUserId,
      channel_app_id: this.channelAppId,
      username: cleanOptional(args.telegramUsername) || null,
    })

    try {
      const env = await this.post("guard_telegram_resolve_response", "/api/guard/channels/telegram/resolve", {
        channel_user_id: telegramUserId,
        channel_app_id: this.channelAppId,
      })

      const persisted = await this.persistLink(telegramUserId, args.telegramUsername, env.link)
      this.logPersistResult("resolve", telegramUserId, persisted)
      if (!persisted) {
        return {
          linked: false,
          code: "guard_unavailable",
          message: "Could not confirm link result. Please try again.",
        }
      }
      if (persisted.status !== "linked") {
        return {
          linked: false,
          code: "not_linked",
          message: buildUnlinkedMessage(),
        }
      }

      return {
        linked: true,
        source: "resolve",
        subject: toLinkedSubject(persisted),
        link: persisted,
      }
    } catch (error) {
      const guardError = toGuardError(error)
      return {
        linked: false,
        code: guardError.code,
        message: guardError.message,
      }
    }
  }

  async ensureLinkedForPaymentAction(args: {
    telegramUserId: string
    telegramUsername?: string
  }): Promise<
    | { allowed: true; subject: LinkedValuyaSubject; link: StoredTelegramChannelLink }
    | { allowed: false; reply: string; code: LinkErrorCode }
  > {
    const telegramUserId = normalizeTelegramUserId(args.telegramUserId)

    // Prefer deterministic local link immediately after redeem; backend remains source of truth on cache miss.
    const local = await this.linkStore.getChannelLink(telegramUserId)
    if (isLinked(local)) {
      this.log("guard_telegram_link_local_hit", {
        tenant: tenantRef(this.tenantToken),
        channel_user_id: telegramUserId,
        channel_app_id: local.channel_app_id,
        status: local.status,
      })
      return {
        allowed: true,
        subject: toLinkedSubject(local),
        link: local,
      }
    }

    const resolved = await this.resolveLinkedSubject({
      telegramUserId,
      telegramUsername: args.telegramUsername,
    })
    if (resolved.linked) {
      return {
        allowed: true,
        subject: resolved.subject,
        link: resolved.link,
      }
    }

    const reply =
      resolved.code === "not_linked"
        ? buildUnlinkedMessage()
        : `I could not verify your Valuya link (${resolved.code}). Please retry.`

    return {
      allowed: false,
      reply,
      code: resolved.code,
    }
  }

  private async post(eventName: string, path: string, body: Record<string, unknown>): Promise<GuardEnvelope> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Authorization: `Bearer ${this.tenantToken}`,
      },
      body: JSON.stringify(body),
    })

    const payload = (await safeParseJson(response)) as GuardEnvelope
    this.log(eventName, {
      tenant: tenantRef(this.tenantToken),
      path,
      status: response.status,
      ok: response.ok && payload?.ok !== false,
      error_code: payload?.code || payload?.error || null,
    })

    if (!response.ok || payload?.ok === false) {
      throw toGuardApiError(response.status, payload)
    }

    return payload
  }

  private async persistLink(
    telegramUserId: string,
    telegramUsername: string | undefined,
    link: GuardChannelLink | null | undefined,
  ): Promise<StoredTelegramChannelLink | null> {
    const status = String(link?.status || "").trim() || "unlinked"

    const normalizedWallet = normalizeWallet(link?.wallet_address)
    const subjectType = String(link?.subject?.type || "").trim()
    const subjectExternalId = String(link?.subject?.external_id || "").trim()
    const protocolSubjectHeader = normalizeProtocolSubjectHeader(link?.protocol_subject?.header)
    const parsedProtocolSubject = parseProtocolSubjectHeader(protocolSubjectHeader)
    const protocolSubjectType = cleanOptional(link?.protocol_subject?.type) || parsedProtocolSubject?.type
    const protocolSubjectId = stringOrUndefined(link?.protocol_subject?.id) || parsedProtocolSubject?.id
    const channelAppId = String(link?.channel_app_id || this.channelAppId).trim()

    if (status === "linked" && (!protocolSubjectHeader || !parsedProtocolSubject || !normalizedWallet)) {
      this.log("guard_telegram_link_persist_rejected", {
        tenant: tenantRef(this.tenantToken),
        channel_user_id: telegramUserId,
        status,
        channel_app_id: channelAppId,
        protocol_subject_header: protocolSubjectHeader || null,
        has_protocol_subject_header: Boolean(protocolSubjectHeader),
        protocol_subject_valid: Boolean(parsedProtocolSubject),
        wallet_address: normalizedWallet || null,
        has_wallet_address: Boolean(normalizedWallet),
        subject_type: subjectType || null,
        subject_external_id: subjectExternalId || null,
        reason: !protocolSubjectHeader
          ? "missing_protocol_subject_header"
          : !parsedProtocolSubject
            ? "invalid_protocol_subject_header"
            : "missing_wallet_address",
      })
      return null
    }

    return this.linkStore.upsertChannelLink(telegramUserId, {
      telegram_user_id: telegramUserId,
      telegram_username: cleanOptional(telegramUsername),
      tenant_id: stringOrUndefined(link?.tenant_id),
      channel_app_id: channelAppId,
      valuya_subject_id: stringOrUndefined(link?.subject_id),
      valuya_subject_type: subjectType || undefined,
      valuya_subject_external_id: subjectExternalId || undefined,
      valuya_privy_user_id: cleanOptional(link?.privy_user_id),
      valuya_linked_wallet_address: normalizedWallet,
      valuya_privy_wallet_id: cleanOptional(link?.privy_wallet_id),
      valuya_protocol_subject_type: protocolSubjectType,
      valuya_protocol_subject_id: protocolSubjectId,
      valuya_protocol_subject_header: cleanOptional(protocolSubjectHeader),
      status,
      linked_at: status === "linked" ? new Date().toISOString() : undefined,
    })
  }

  private logPersistResult(
    source: "redeem" | "resolve",
    channelUserId: string,
    persisted: StoredTelegramChannelLink | null,
  ): void {
    const canonicalAccepted = Boolean(
      persisted?.status === "linked" &&
        persisted?.valuya_protocol_subject_header &&
        persisted?.valuya_linked_wallet_address,
    )
    const payload = {
      tenant: tenantRef(this.tenantToken),
      source,
      channel_user_id: channelUserId,
      persisted: Boolean(persisted),
      status: persisted?.status || null,
      protocol_subject_header: persisted?.valuya_protocol_subject_header || null,
      wallet_address: persisted?.valuya_linked_wallet_address || null,
      privy_wallet_id: persisted?.valuya_privy_wallet_id || null,
      canonical_fields_accepted: canonicalAccepted,
    }
    this.log("guard_telegram_link_persist_result", payload)
    if (source === "redeem" && canonicalAccepted) {
      this.log("guard_telegram_link_persisted_from_redeem", payload)
    }
  }
}

export function extractStartLinkToken(text: string): string | null {
  const match = /^\/start(?:@\w+)?(?:\s+(\S+))?$/i.exec(String(text || "").trim())
  const token = String(match?.[1] || "").trim()
  if (!token) return null
  return token
}

function buildUnlinkedMessage(): string {
  return [
    "Your Telegram account is not linked to Valuya yet.",
    "Please open your latest onboarding link to Telegram and run /start again.",
  ].join("\n")
}

function toLinkedSubject(link: StoredTelegramChannelLink): LinkedValuyaSubject {
  const protocolSubject = requireProtocolSubject(link)
  return {
    type: protocolSubject.type,
    externalId: protocolSubject.id,
    ...(link.valuya_subject_id ? { subjectId: link.valuya_subject_id } : {}),
    ...(link.valuya_privy_user_id ? { privyUserId: link.valuya_privy_user_id } : {}),
    ...(link.valuya_linked_wallet_address
      ? { linkedWalletAddress: link.valuya_linked_wallet_address }
      : {}),
  }
}

function isLinked(link: StoredTelegramChannelLink | null): link is StoredTelegramChannelLink {
  if (!link) return false
  return (
    link.status === "linked" &&
    hasCanonicalProtocolSubject(link) &&
    Boolean(link.valuya_linked_wallet_address?.trim())
  )
}

class GuardApiError extends Error {
  readonly code: LinkErrorCode

  constructor(code: LinkErrorCode, message: string) {
    super(message)
    this.code = code
  }
}

function toGuardApiError(status: number, payload: GuardEnvelope): GuardApiError {
  const backendCode = `${payload?.code || payload?.error || payload?.message || ""}`.toLowerCase()

  if (status === 404 || backendCode.includes("not_linked")) {
    return new GuardApiError("not_linked", buildUnlinkedMessage())
  }
  if (backendCode.includes("invalid") || backendCode.includes("malformed")) {
    return new GuardApiError("invalid_token", "Invalid link token. Please use the latest onboarding link.")
  }
  if (backendCode.includes("expired")) {
    return new GuardApiError("token_expired", "This link token has expired. Please restart onboarding.")
  }
  if (backendCode.includes("already") || backendCode.includes("used")) {
    return new GuardApiError(
      "token_already_used",
      "This link token was already used. Open your latest onboarding link and retry.",
    )
  }
  if (backendCode.includes("tenant_mismatch")) {
    return new GuardApiError(
      "tenant_mismatch",
      "This onboarding link belongs to a different tenant. Generate a new link for this bot and retry.",
    )
  }

  return new GuardApiError("guard_unavailable", "Valuya Guard is currently unavailable. Please retry.")
}

function toGuardError(error: unknown): GuardApiError {
  if (error instanceof GuardApiError) return error
  const message = error instanceof Error ? error.message : String(error)
  return new GuardApiError("guard_unavailable", `Valuya Guard is currently unavailable. (${message})`)
}

async function safeParseJson(response: Response): Promise<unknown> {
  const text = await response.text()
  if (!text) return {}
  try {
    return JSON.parse(text)
  } catch {
    return { message: text }
  }
}

function cleanOptional(input: unknown): string | undefined {
  const value = String(input || "").trim()
  return value || undefined
}

function stringOrUndefined(input: unknown): string | undefined {
  if (typeof input === "number" && Number.isFinite(input)) return String(input)
  const value = String(input || "").trim()
  return value || undefined
}

function normalizeTelegramUserId(input: string): string {
  const value = String(input || "").trim()
  if (!/^\d+$/.test(value)) {
    throw new Error("telegram_channel_user_id_invalid")
  }
  return value
}

function tenantRef(token: string): string {
  const v = String(token || "").trim()
  return v ? v.slice(0, 12) : "unknown"
}

function normalizeWallet(input: unknown): string | undefined {
  const value = String(input || "").trim().toLowerCase()
  if (!value) return undefined
  if (!/^0x[a-f0-9]{40}$/.test(value)) return undefined
  return value
}

function normalizeProtocolSubjectHeader(input: unknown): string {
  return String(input || "").trim()
}

function hasCanonicalProtocolSubject(link: StoredTelegramChannelLink): boolean {
  return parseProtocolSubjectHeader(link.valuya_protocol_subject_header || "") !== null
}

function requireProtocolSubject(
  link: StoredTelegramChannelLink,
): { type: string; id: string; header: string } {
  const header = String(link.valuya_protocol_subject_header || "").trim()
  const parsed = parseProtocolSubjectHeader(header)
  if (!parsed) {
    throw new Error("guard_protocol_subject_missing")
  }
  return parsed
}

function parseProtocolSubjectHeader(
  header: string,
): { type: string; id: string; header: string } | null {
  const value = String(header || "").trim()
  const idx = value.indexOf(":")
  if (idx <= 0 || idx === value.length - 1) return null
  if (value.indexOf(":", idx + 1) !== -1) return null
  const type = value.slice(0, idx).trim()
  const id = value.slice(idx + 1).trim()
  if (!type || !id) return null
  return { type, id, header: `${type}:${id}` }
}
