import type { GuardTelegramLinkService } from "./channelLinking.js"
import type { StoredTelegramChannelLink } from "./linkStore.js"

type LogFn = (event: string, fields: Record<string, unknown>) => void

type LinkedGate =
  | {
      allowed: true
      link: StoredTelegramChannelLink
    }
  | {
      allowed: false
      reply: string
      code: string
    }

export type TelegramPaidChannelAccessConfig = {
  baseUrl: string
  tenantToken: string
  linking: GuardTelegramLinkService
  channelResource?: string
  channelBot?: string
  channelName?: string
  channelPlan?: string
  channelInviteUrl?: string
  logger?: LogFn
}

export type TelegramChannelAccessResult =
  | {
      allowed: true
      reason: "entitled"
      protocolSubjectHeader: string
      resource: string
      plan: string
      joinUrl: string | null
    }
  | {
      allowed: false
      reason: "not_linked" | "inactive" | "guard_unavailable"
      protocolSubjectHeader: string | null
      resource: string
      plan: string
      reply: string
    }

export class TelegramPaidChannelAccessService {
  private readonly baseUrl: string
  private readonly tenantToken: string
  private readonly linking: GuardTelegramLinkService
  private readonly resource: string
  private readonly plan: string
  private readonly inviteUrl: string | null
  private readonly log: LogFn

  constructor(config: TelegramPaidChannelAccessConfig) {
    this.baseUrl = config.baseUrl.replace(/\/+$/, "")
    this.tenantToken = String(config.tenantToken || "").trim()
    this.linking = config.linking
    this.resource = buildTelegramChannelResource({
      resource: config.channelResource,
      bot: config.channelBot,
      channel: config.channelName,
    })
    this.plan = String(config.channelPlan || "standard").trim() || "standard"
    this.inviteUrl = cleanOptional(config.channelInviteUrl) || null
    this.log =
      config.logger ||
      ((event, fields) => {
        console.log(JSON.stringify({ level: "info", event, ...fields }))
      })

    if (!this.baseUrl) throw new Error("paid_channel_base_url_required")
    if (!this.tenantToken) throw new Error("paid_channel_tenant_token_required")
  }

  async resolveAccess(args: {
    telegramUserId: string
    telegramUsername?: string
  }): Promise<TelegramChannelAccessResult> {
    const telegramUserId = String(args.telegramUserId || "").trim()
    this.log("telegram_channel_access_request", {
      tenant: tokenPreview(this.tenantToken),
      telegram_user_id: telegramUserId,
      resource: this.resource,
      plan: this.plan,
    })

    const linked = (await this.linking.ensureLinkedForPaymentAction({
      telegramUserId,
      telegramUsername: args.telegramUsername,
    })) as LinkedGate

    if (!linked.allowed) {
      const result: TelegramChannelAccessResult = {
        allowed: false,
        reason: linked.code === "not_linked" ? "not_linked" : "guard_unavailable",
        protocolSubjectHeader: null,
        resource: this.resource,
        plan: this.plan,
        reply: linked.reply,
      }
      this.log("telegram_channel_access_result", {
        tenant: tokenPreview(this.tenantToken),
        telegram_user_id: telegramUserId,
        protocol_subject_header: null,
        resource: this.resource,
        plan: this.plan,
        allowed: false,
        reason: result.reason,
      })
      return result
    }

    const protocolSubjectHeader = String(linked.link.valuya_protocol_subject_header || "").trim()
    if (!protocolSubjectHeader) {
      const reply = "Linked subject is missing. Please run onboarding /start again."
      this.log("telegram_channel_access_result", {
        tenant: tokenPreview(this.tenantToken),
        telegram_user_id: telegramUserId,
        protocol_subject_header: null,
        resource: this.resource,
        plan: this.plan,
        allowed: false,
        reason: "guard_unavailable",
      })
      return {
        allowed: false,
        reason: "guard_unavailable",
        protocolSubjectHeader: null,
        resource: this.resource,
        plan: this.plan,
        reply,
      }
    }

    const entitlement = await this.fetchEntitlement(protocolSubjectHeader)
    const active = entitlement?.active === true
    if (!active) {
      const reply =
        "Access to this Telegram channel is locked. Please activate payment/plan in Valuya, then retry."
      this.log("telegram_channel_access_result", {
        tenant: tokenPreview(this.tenantToken),
        telegram_user_id: telegramUserId,
        protocol_subject_header: protocolSubjectHeader,
        resource: this.resource,
        plan: this.plan,
        allowed: false,
        reason: "inactive",
      })
      return {
        allowed: false,
        reason: "inactive",
        protocolSubjectHeader,
        resource: this.resource,
        plan: this.plan,
        reply,
      }
    }

    this.log("telegram_channel_access_result", {
      tenant: tokenPreview(this.tenantToken),
      telegram_user_id: telegramUserId,
      protocol_subject_header: protocolSubjectHeader,
      resource: this.resource,
      plan: this.plan,
      allowed: true,
      reason: "entitled",
    })
    if (this.inviteUrl) {
      this.log("telegram_channel_invite_sent", {
        tenant: tokenPreview(this.tenantToken),
        telegram_user_id: telegramUserId,
        protocol_subject_header: protocolSubjectHeader,
        resource: this.resource,
        plan: this.plan,
        join_url: this.inviteUrl,
      })
    }
    return {
      allowed: true,
      reason: "entitled",
      protocolSubjectHeader,
      resource: this.resource,
      plan: this.plan,
      joinUrl: this.inviteUrl,
    }
  }

  private async fetchEntitlement(protocolSubjectHeader: string): Promise<{ active?: boolean; reason?: string }> {
    const url = new URL(`${this.baseUrl}/api/v2/entitlements`)
    url.searchParams.set("resource", this.resource)
    url.searchParams.set("plan", this.plan)

    const response = await fetch(url.toString(), {
      method: "GET",
      headers: {
        Authorization: `Bearer ${this.tenantToken}`,
        Accept: "application/json",
        "X-Valuya-Subject-Id": protocolSubjectHeader,
      },
    })
    const body = await safeParseJson(response)
    if (!response.ok) {
      throw new Error(
        `telegram_channel_entitlement_failed:${response.status}:${JSON.stringify(body).slice(0, 300)}`,
      )
    }
    return (body && typeof body === "object" ? (body as Record<string, unknown>) : {}) as {
      active?: boolean
      reason?: string
    }
  }
}

export function buildTelegramChannelResource(args: {
  resource?: string
  bot?: string
  channel?: string
}): string {
  const explicit = cleanOptional(args.resource)
  if (explicit) return explicit

  const bot = cleanOptional(args.bot)
  const channel = cleanOptional(args.channel)
  if (!bot || !channel) {
    throw new Error("telegram_channel_resource_config_missing")
  }
  return `telegram:channel:${bot}:${channel}`
}

async function safeParseJson(response: Response): Promise<unknown> {
  const text = await response.text()
  if (!text) return {}
  try {
    return JSON.parse(text)
  } catch {
    return { raw: text }
  }
}

function cleanOptional(value: unknown): string | undefined {
  const v = String(value || "").trim()
  return v || undefined
}

function tokenPreview(token: string): string {
  const t = String(token || "").trim()
  return t ? t.slice(0, 12) : "unknown"
}
