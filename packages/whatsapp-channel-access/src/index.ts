export type WhatsAppChannelAccessConfig = {
  baseUrl: string
  tenantToken: string
  channelResource?: string
  channelProvider?: string
  channelIdentifier?: string
  channelPhoneNumber?: string
  channelPlan?: string
  channelVisitUrl?: string
  linking: WhatsAppLinkResolver
  logger?: (event: string, fields: Record<string, unknown>) => void
}

export type WhatsAppLinkResolver = {
  ensureLinkedForPaymentAction(args: {
    whatsappUserId: string
    whatsappProfileName?: string
  }): Promise<
    | {
        allowed: true
        link: {
          valuya_protocol_subject_header?: string
        }
      }
    | {
        allowed: false
        code: string
        reply: string
      }
  >
}

export type WhatsAppChannelAccessResult =
  | {
      allowed: true
      reason: "entitled"
      protocolSubjectHeader: string
      resource: string
      plan: string
      channelUrl: string | null
    }
  | {
      allowed: false
      reason: "not_linked" | "inactive" | "guard_unavailable"
      protocolSubjectHeader: string | null
      resource: string
      plan: string
      reply: string
    }

export class WhatsAppChannelAccessService {
  private readonly baseUrl: string
  private readonly tenantToken: string
  private readonly resource: string
  private readonly plan: string
  private readonly visitUrl: string | null
  private readonly linking: WhatsAppLinkResolver
  private readonly log: (event: string, fields: Record<string, unknown>) => void

  constructor(config: WhatsAppChannelAccessConfig) {
    this.baseUrl = String(config.baseUrl || "").trim().replace(/\/+$/, "")
    this.tenantToken = String(config.tenantToken || "").trim()
    this.resource = buildWhatsAppChannelResource({
      resource: config.channelResource,
      provider: config.channelProvider,
      channelIdentifier: config.channelIdentifier,
      phoneNumber: config.channelPhoneNumber,
    })
    this.plan = String(config.channelPlan || "standard").trim() || "standard"
    this.visitUrl = cleanOptional(config.channelVisitUrl) || null
    this.linking = config.linking
    this.log =
      config.logger ||
      ((event, fields) => {
        console.log(JSON.stringify({ level: "info", event, ...fields }))
      })

    if (!this.baseUrl) throw new Error("whatsapp_channel_base_url_required")
    if (!this.tenantToken) throw new Error("whatsapp_channel_tenant_token_required")
  }

  async resolveAccess(args: {
    whatsappUserId: string
    whatsappProfileName?: string
  }): Promise<WhatsAppChannelAccessResult> {
    const whatsappUserId = String(args.whatsappUserId || "").trim()
    this.log("whatsapp_channel_access_request", {
      tenant: tokenPreview(this.tenantToken),
      whatsapp_user_id: whatsappUserId,
      resource: this.resource,
      plan: this.plan,
    })

    const linked = await this.linking.ensureLinkedForPaymentAction({
      whatsappUserId,
      whatsappProfileName: args.whatsappProfileName,
    })

    if (!linked.allowed) {
      const reason = linked.code === "not_linked" ? "not_linked" : "guard_unavailable"
      this.log("whatsapp_channel_access_result", {
        tenant: tokenPreview(this.tenantToken),
        whatsapp_user_id: whatsappUserId,
        protocol_subject_header: null,
        resource: this.resource,
        plan: this.plan,
        allowed: false,
        reason,
      })
      return {
        allowed: false,
        reason,
        protocolSubjectHeader: null,
        resource: this.resource,
        plan: this.plan,
        reply: linked.reply,
      }
    }

    const protocolSubjectHeader = String(linked.link.valuya_protocol_subject_header || "").trim()
    if (!protocolSubjectHeader) {
      const reply = "Linked protocol subject is missing. Please restart onboarding."
      this.log("whatsapp_channel_access_result", {
        tenant: tokenPreview(this.tenantToken),
        whatsapp_user_id: whatsappUserId,
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
    if (entitlement.active !== true) {
      this.log("whatsapp_channel_access_result", {
        tenant: tokenPreview(this.tenantToken),
        whatsapp_user_id: whatsappUserId,
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
        reply: "Channel access is locked. Payment/plan activation is required.",
      }
    }

    this.log("whatsapp_channel_access_result", {
      tenant: tokenPreview(this.tenantToken),
      whatsapp_user_id: whatsappUserId,
      protocol_subject_header: protocolSubjectHeader,
      resource: this.resource,
      plan: this.plan,
      allowed: true,
      reason: "entitled",
    })

    if (this.visitUrl) {
      this.log("whatsapp_channel_link_sent", {
        tenant: tokenPreview(this.tenantToken),
        whatsapp_user_id: whatsappUserId,
        protocol_subject_header: protocolSubjectHeader,
        resource: this.resource,
        plan: this.plan,
        channel_url: this.visitUrl,
      })
    }

    return {
      allowed: true,
      reason: "entitled",
      protocolSubjectHeader,
      resource: this.resource,
      plan: this.plan,
      channelUrl: this.visitUrl,
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
        `whatsapp_channel_entitlement_failed:${response.status}:${JSON.stringify(body).slice(0, 300)}`,
      )
    }
    return (body && typeof body === "object" ? (body as Record<string, unknown>) : {}) as {
      active?: boolean
      reason?: string
    }
  }
}

export function buildWhatsAppChannelResource(args: {
  resource?: string
  provider?: string
  channelIdentifier?: string
  phoneNumber?: string
}): string {
  const explicit = cleanOptional(args.resource)
  if (explicit) return explicit

  const provider = cleanOptional(args.provider)
  const channelIdentifier = cleanOptional(args.channelIdentifier)
  const phone = cleanOptional(args.phoneNumber)
  if (!provider || !channelIdentifier || !phone) {
    throw new Error("whatsapp_channel_resource_config_missing")
  }
  return `whatsapp:channel:${provider}:${channelIdentifier}:${normalizePhone(phone)}`
}

function normalizePhone(input: string): string {
  return String(input || "").trim().replace(/^\+/, "").replace(/\s+/g, "")
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
