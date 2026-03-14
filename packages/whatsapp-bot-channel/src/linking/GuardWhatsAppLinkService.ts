import type { FileStateStore, StoredChannelLink } from "./FileStateStore.js"

export type LinkedValuyaSubject = {
  type: string
  externalId: string
  subjectId?: string
  privyUserId?: string
  linkedWalletAddress?: string
  guardSubjectId?: string
  guardSubjectType?: string
  guardSubjectExternalId?: string
  protocolSubjectHeader?: string
}

export type LinkErrorCode =
  | "invalid_token"
  | "token_expired"
  | "token_already_used"
  | "tenant_mismatch"
  | "not_linked"
  | "guard_unavailable"

export type LinkResult =
  | {
      linked: true
      source: "redeem" | "resolve" | "resolve_after_redeem_failure"
      subject: LinkedValuyaSubject
      link: StoredChannelLink
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

export class GuardWhatsAppLinkService {
  private readonly baseUrl: string
  private readonly tenantToken: string
  private readonly channelAppId: string
  private readonly redeemedFrom: string
  private readonly stateStore: FileStateStore
  private readonly requestTimeoutMs: number

  constructor(args: {
    baseUrl: string
    tenantToken: string
    channelAppId: string
    stateStore: FileStateStore
    redeemedFrom?: string
    requestTimeoutMs?: number
  }) {
    this.baseUrl = args.baseUrl.replace(/\/+$/, "")
    this.tenantToken = args.tenantToken
    this.channelAppId = args.channelAppId
    this.stateStore = args.stateStore
    this.redeemedFrom = args.redeemedFrom?.trim() || "whatsapp_bot_channel"
    this.requestTimeoutMs = args.requestTimeoutMs ?? 8_000
  }

  async redeemLinkToken(args: {
    whatsappUserId: string
    linkToken: string
    whatsappProfileName?: string
  }): Promise<LinkResult> {
    const linkToken = String(args.linkToken || "").trim()
    if (!linkToken) {
      return {
        linked: false,
        code: "invalid_token",
        message: "Ungueltiger Link-Code. Bitte pruefe die LINK Nachricht.",
      }
    }

    try {
      const env = await this.post<GuardEnvelope>("/api/guard/channels/whatsapp/redeem", {
        link_token: linkToken,
        channel_user_id: args.whatsappUserId,
        channel_username: cleanOptional(args.whatsappProfileName),
        channel_app_id: this.channelAppId,
        redeemed_from: this.redeemedFrom,
      })

      const persisted = await this.persistLink({
        whatsappUserId: args.whatsappUserId,
        whatsappProfileName: args.whatsappProfileName,
        link: env.link,
      })
      if (!persisted) {
        return {
          linked: false,
          code: "guard_unavailable",
          message: "Link konnte nicht bestaetigt werden. Bitte erneut versuchen.",
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
          whatsappUserId: args.whatsappUserId,
          whatsappProfileName: args.whatsappProfileName,
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
    whatsappUserId: string
    whatsappProfileName?: string
  }): Promise<LinkResult> {
    try {
      const env = await this.post<GuardEnvelope>("/api/guard/channels/whatsapp/resolve", {
        channel_user_id: args.whatsappUserId,
        channel_app_id: this.channelAppId,
      })

      const persisted = await this.persistLink({
        whatsappUserId: args.whatsappUserId,
        whatsappProfileName: args.whatsappProfileName,
        link: env.link,
      })

      if (!persisted || persisted.status !== "linked") {
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
    whatsappUserId: string
    whatsappProfileName?: string
  }): Promise<
    | { allowed: true; subject: LinkedValuyaSubject; link: StoredChannelLink }
    | { allowed: false; reply: string; code: LinkErrorCode }
  > {
    const local = await this.stateStore.getChannelLink(args.whatsappUserId)
    if (isLinked(local)) {
      return {
        allowed: true,
        subject: toLinkedSubject(local),
        link: local,
      }
    }

    const resolved = await this.resolveLinkedSubject(args)
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
        : `Kontoverknuepfung konnte nicht geprueft werden (${resolved.code}). Bitte erneut versuchen.`

    return {
      allowed: false,
      reply,
      code: resolved.code,
    }
  }

  private async post<T>(path: string, body: Record<string, unknown>): Promise<T> {
    const url = `${this.baseUrl}${path}`
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), this.requestTimeoutMs)

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          Authorization: `Bearer ${this.tenantToken}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      })

      const payload = (await safeParseJson(response)) as GuardEnvelope
      if (!response.ok || payload?.ok === false) {
        throw toGuardApiError(path, response.status, payload)
      }

      return payload as T
    } catch (error) {
      if (isAbortError(error)) {
        throw new GuardApiError(
          "guard_unavailable",
          `Valuya Guard ist gerade nicht erreichbar. (timeout_after_${this.requestTimeoutMs}ms)`,
        )
      }
      throw error
    } finally {
      clearTimeout(timeout)
    }
  }

  private async persistLink(args: {
    whatsappUserId: string
    whatsappProfileName?: string
    link?: GuardChannelLink | null
  }): Promise<StoredChannelLink | null> {
    const status = String(args.link?.status || "").trim() || "unlinked"

    const normalizedWallet = normalizeWallet(args.link?.wallet_address)
    const subjectType = String(args.link?.subject?.type || "").trim()
    const subjectExternalId = String(args.link?.subject?.external_id || "").trim()
    const protocolSubjectHeader = normalizeProtocolSubjectHeader(args.link?.protocol_subject?.header)
    const parsedProtocolSubject = parseProtocolSubjectHeader(protocolSubjectHeader)
    const protocolSubjectType = cleanOptional(args.link?.protocol_subject?.type) || parsedProtocolSubject?.type
    const protocolSubjectId = stringOrUndefined(args.link?.protocol_subject?.id) || parsedProtocolSubject?.id
    const channelAppId = String(args.link?.channel_app_id || this.channelAppId).trim()

    if (status === "linked" && (!protocolSubjectHeader || !parsedProtocolSubject || !normalizedWallet)) {
      return null
    }

    return this.stateStore.upsertChannelLink(args.whatsappUserId, {
      whatsapp_user_id: args.whatsappUserId,
      whatsapp_profile_name: cleanOptional(args.whatsappProfileName),
      tenant_id: stringOrUndefined(args.link?.tenant_id),
      channel_app_id: channelAppId,
      valuya_subject_id: stringOrUndefined(args.link?.subject_id),
      valuya_subject_type: subjectType || undefined,
      valuya_subject_external_id: subjectExternalId || undefined,
      valuya_privy_user_id: cleanOptional(args.link?.privy_user_id),
      valuya_linked_wallet_address: normalizedWallet,
      valuya_privy_wallet_id: cleanOptional(args.link?.privy_wallet_id),
      valuya_protocol_subject_type: protocolSubjectType,
      valuya_protocol_subject_id: protocolSubjectId,
      valuya_protocol_subject_header: cleanOptional(protocolSubjectHeader),
      status,
      linked_at: status === "linked" ? new Date().toISOString() : undefined,
      meta: {
        guard_link_id: stringOrUndefined(args.link?.id),
      },
    })
  }
}

function buildUnlinkedMessage(): string {
  return [
    "Bevor ich bestellen kann, musst du dein Valuya Konto verknuepfen.",
    "Sende die Onboarding-Nachricht im Format: LINK gls_...",
  ].join("\n")
}

function toLinkedSubject(link: StoredChannelLink): LinkedValuyaSubject {
  const protocol = requireProtocolSubject(link)
  return {
    type: protocol.type,
    externalId: protocol.id,
    ...(link.valuya_subject_id ? { subjectId: link.valuya_subject_id } : {}),
    ...(link.valuya_privy_user_id ? { privyUserId: link.valuya_privy_user_id } : {}),
    ...(link.valuya_linked_wallet_address ? { linkedWalletAddress: link.valuya_linked_wallet_address } : {}),
    ...(link.valuya_subject_id ? { guardSubjectId: link.valuya_subject_id } : {}),
    ...(link.valuya_subject_type ? { guardSubjectType: link.valuya_subject_type } : {}),
    ...(link.valuya_subject_external_id ? { guardSubjectExternalId: link.valuya_subject_external_id } : {}),
    ...(link.valuya_protocol_subject_header ? { protocolSubjectHeader: link.valuya_protocol_subject_header } : {}),
  }
}

class GuardApiError extends Error {
  readonly code: LinkErrorCode

  constructor(code: LinkErrorCode, message: string) {
    super(message)
    this.code = code
  }
}

function toGuardApiError(path: string, status: number, payload: GuardEnvelope): GuardApiError {
  const backendCode = `${payload?.code || payload?.error || payload?.message || ""}`.toLowerCase()

  if (path.endsWith("/resolve") && (status === 404 || backendCode.includes("not_linked"))) {
    return new GuardApiError("not_linked", buildUnlinkedMessage())
  }
  if (backendCode.includes("invalid") || backendCode.includes("malformed")) {
    return new GuardApiError("invalid_token", "Ungueltiger Link-Code. Bitte pruefe die LINK Nachricht.")
  }
  if (backendCode.includes("expired")) {
    return new GuardApiError("token_expired", "Dieser Link-Code ist abgelaufen. Bitte starte Onboarding erneut.")
  }
  if (backendCode.includes("already") || backendCode.includes("used")) {
    return new GuardApiError(
      "token_already_used",
      "Dieser Link-Code wurde bereits verwendet. Nutze den neuesten Onboarding-Link.",
    )
  }
  if (backendCode.includes("tenant_mismatch")) {
    return new GuardApiError(
      "tenant_mismatch",
      "Dieser Onboarding-Link gehoert zu einem anderen Tenant. Bitte einen neuen Link fuer diesen Bot erzeugen.",
    )
  }
  return new GuardApiError(
    "guard_unavailable",
    "Valuya Guard ist gerade nicht erreichbar. Bitte erneut versuchen.",
  )
}

function toGuardError(error: unknown): GuardApiError {
  if (error instanceof GuardApiError) return error
  const message = error instanceof Error ? error.message : String(error)
  return new GuardApiError("guard_unavailable", `Valuya Guard ist gerade nicht erreichbar. (${message})`)
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError"
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

function normalizeWallet(input: unknown): string | undefined {
  const value = String(input || "").trim().toLowerCase()
  if (!value) return undefined
  if (!/^0x[a-f0-9]{40}$/.test(value)) return undefined
  return value
}

function normalizeProtocolSubjectHeader(input: unknown): string {
  return String(input || "").trim()
}

function parseProtocolSubjectHeader(header: string): { type: string; id: string; header: string } | null {
  const value = String(header || "").trim()
  const idx = value.indexOf(":")
  if (idx <= 0 || idx === value.length - 1) return null
  if (value.indexOf(":", idx + 1) !== -1) return null
  const type = value.slice(0, idx).trim()
  const id = value.slice(idx + 1).trim()
  if (!type || !id) return null
  return { type, id, header: `${type}:${id}` }
}

function requireProtocolSubject(link: StoredChannelLink): { type: string; id: string; header: string } {
  const parsed = parseProtocolSubjectHeader(link.valuya_protocol_subject_header || "")
  if (!parsed) throw new Error("guard_protocol_subject_missing")
  return parsed
}

function isLinked(link: StoredChannelLink | null): link is StoredChannelLink {
  if (!link) return false
  return (
    link.status === "linked" &&
    Boolean(parseProtocolSubjectHeader(link.valuya_protocol_subject_header || "")) &&
    Boolean(link.valuya_linked_wallet_address?.trim())
  )
}

function stringOrUndefined(input: unknown): string | undefined {
  if (typeof input === "number" && Number.isFinite(input)) return String(input)
  const value = String(input || "").trim()
  return value || undefined
}
