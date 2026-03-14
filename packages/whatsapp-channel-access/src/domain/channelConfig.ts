import type { ChannelMode, LogFn, SoulDefinition, WhatsAppLinkResolver } from "./types.js"
import { buildWhatsAppChannelResource } from "../index.helpers.js"

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
  logger?: LogFn
  allowEntitlementFallbackOnServerError?: boolean
}

export type WhatsAppChannelRuntimeConfig = WhatsAppChannelAccessConfig & {
  mode: ChannelMode
  souls?: SoulDefinition[]
}

export function resolveChannelConfig(config: WhatsAppChannelAccessConfig) {
  const baseUrl = String(config.baseUrl || "").trim().replace(/\/+$/, "")
  const tenantToken = String(config.tenantToken || "").trim()
  const resource = buildWhatsAppChannelResource({
    resource: config.channelResource,
    provider: config.channelProvider,
    channelIdentifier: config.channelIdentifier,
    phoneNumber: config.channelPhoneNumber,
  })
  const plan = String(config.channelPlan || "standard").trim() || "standard"
  const channelUrl = cleanOptional(config.channelVisitUrl) || null
  const logger: LogFn =
    config.logger ||
    ((event, fields) => {
      console.log(JSON.stringify({ level: "info", event, ...fields }))
    })

  if (!baseUrl) throw new Error("whatsapp_channel_base_url_required")
  if (!tenantToken) throw new Error("whatsapp_channel_tenant_token_required")

  return {
    baseUrl,
    tenantToken,
    resource,
    plan,
    channelUrl,
    channelMetadata: {
      kind: "whatsapp",
      provider: cleanOptional(config.channelProvider) || null,
      channel_identifier: cleanOptional(config.channelIdentifier) || null,
      phone_number: cleanOptional(config.channelPhoneNumber)?.replace(/^\+/, "") || null,
      bot_name: null,
      chat_id: null,
    },
    allowEntitlementFallbackOnServerError: config.allowEntitlementFallbackOnServerError === true,
    linking: config.linking,
    logger,
  }
}

function cleanOptional(value: unknown): string | undefined {
  const v = String(value || "").trim()
  return v || undefined
}
