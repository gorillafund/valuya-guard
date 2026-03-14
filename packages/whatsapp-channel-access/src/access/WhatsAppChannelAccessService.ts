import type { WhatsAppChannelAccessConfig } from "../domain/channelConfig.js"
import { resolveChannelConfig } from "../domain/channelConfig.js"
import type { ChannelMandateResolver } from "./ChannelMandateResolver.js"
import { GuardChannelMandateResolver } from "./GuardChannelMandateResolver.js"
import { toAccessDecision } from "./ChannelPolicy.js"
import type { WhatsAppChannelAccessDecision } from "../domain/types.js"

export class WhatsAppChannelAccessService {
  private readonly mandateResolver: ChannelMandateResolver
  private readonly config: ReturnType<typeof resolveChannelConfig>

  constructor(config: WhatsAppChannelAccessConfig, mandateResolver?: ChannelMandateResolver) {
    this.config = resolveChannelConfig(config)
    this.mandateResolver = mandateResolver || new GuardChannelMandateResolver({
      baseUrl: this.config.baseUrl,
      tenantToken: this.config.tenantToken,
      channelUrl: this.config.channelUrl,
      logger: this.config.logger,
      channelMetadata: this.config.channelMetadata,
      allowEntitlementFallbackOnServerError: this.config.allowEntitlementFallbackOnServerError,
    })
  }

  async resolveAccess(args: {
    whatsappUserId: string
    whatsappProfileName?: string
  }): Promise<WhatsAppChannelAccessDecision> {
    const whatsappUserId = String(args.whatsappUserId || "").trim()
    this.config.logger("whatsapp_channel_access_request", {
      tenant: tokenPreview(this.config.tenantToken),
      whatsapp_user_id: whatsappUserId,
      resource: this.config.resource,
      plan: this.config.plan,
    })

    const linked = await this.config.linking.ensureLinkedForPaymentAction({
      whatsappUserId,
      whatsappProfileName: args.whatsappProfileName,
    })

    if (!linked.allowed) {
      const decision = toAccessDecision({
        linkedSubjectHeader: null,
        resource: this.config.resource,
        plan: this.config.plan,
        resolution: {
          state: linked.code === "not_linked" ? "not_linked" : "guard_unavailable",
          reply: linked.reply,
          resource: this.config.resource,
          anchorResource: this.config.resource,
          plan: this.config.plan,
          runtimeConfig: null,
          capabilities: null,
          source: "linking",
        },
      })
      this.config.logger("whatsapp_channel_access_result", {
        tenant: tokenPreview(this.config.tenantToken),
        whatsapp_user_id: whatsappUserId,
        protocol_subject_header: null,
        resource: this.config.resource,
        plan: this.config.plan,
        allowed: false,
        reason: decision.state,
      })
      return decision
    }

    const protocolSubjectHeader = String(linked.link.valuya_protocol_subject_header || "").trim()
    if (!protocolSubjectHeader) {
      const decision = toAccessDecision({
        linkedSubjectHeader: null,
        resource: this.config.resource,
        plan: this.config.plan,
        resolution: {
          state: "guard_unavailable",
          reply: "Linked protocol subject is missing. Please restart onboarding.",
          resource: this.config.resource,
          anchorResource: this.config.resource,
          plan: this.config.plan,
          runtimeConfig: null,
          capabilities: null,
          source: "linking",
        },
      })
      return decision
    }

    const resolution = await this.mandateResolver.resolve({
      protocolSubjectHeader,
      resource: this.config.resource,
      plan: this.config.plan,
    })
    const decision = toAccessDecision({
      linkedSubjectHeader: protocolSubjectHeader,
      resource: this.config.resource,
      plan: this.config.plan,
      resolution,
    })
    this.config.logger("whatsapp_channel_access_result", {
      tenant: tokenPreview(this.config.tenantToken),
      whatsapp_user_id: whatsappUserId,
      protocol_subject_header: protocolSubjectHeader,
      resource: this.config.resource,
      plan: this.config.plan,
      allowed: decision.allowed,
      reason: decision.state,
      expires_at: "expiresAt" in decision ? decision.expiresAt || null : null,
      source: decision.source,
      runtime_config_present: decision.runtimeConfig ? true : false,
      runtime_config_mode: decision.runtimeConfig?.mode || null,
      runtime_config_channel: decision.runtimeConfig?.channel || null,
      runtime_config_channel_kind: decision.runtimeConfig?.channel_kind || null,
      runtime_config_provider: decision.runtimeConfig?.provider || null,
      runtime_config_soul_slug: decision.runtimeConfig?.soul?.slug || null,
      runtime_config_soul_id: decision.runtimeConfig?.soul?.id || null,
    })
    return decision
  }
}

function tokenPreview(token: string): string {
  const t = String(token || "").trim()
  return t ? t.slice(0, 12) : "unknown"
}
