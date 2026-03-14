import type { ChannelMandateResolver } from "./ChannelMandateResolver.js"
import type {
  ChannelAccessResolveRequest,
  ChannelAccessResolveResponse,
  ChannelMandateResolution,
  LogFn,
} from "../domain/types.js"
import { EntitlementBackedMandateResolver } from "./EntitlementBackedMandateResolver.js"

export class GuardChannelMandateResolver implements ChannelMandateResolver {
  constructor(private readonly args: {
    baseUrl: string
    tenantToken: string
    channelUrl?: string | null
    logger?: LogFn
    endpointPath?: string
    channelMetadata?: ChannelAccessResolveRequest["channel"]
    allowEntitlementFallbackOnServerError?: boolean
  }) {}

  async resolve(input: {
    protocolSubjectHeader: string
    resource: string
    plan: string
  }): Promise<ChannelMandateResolution> {
    const endpointPath = this.args.endpointPath || "/api/v2/channel-access/resolve"
    const requestBody: ChannelAccessResolveRequest = {
      resource: input.resource,
      plan: input.plan,
      channel: this.args.channelMetadata || { kind: "whatsapp" },
    }
    const response = await fetch(`${this.args.baseUrl}${endpointPath}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.args.tenantToken}`,
        Accept: "application/json",
        "Content-Type": "application/json",
        "X-Valuya-Subject-Id": input.protocolSubjectHeader,
      },
      body: JSON.stringify(requestBody),
    })
    const body = await safeParseJson(response)
    if (!response.ok) {
      if (shouldFallback(response.status, body, this.args.allowEntitlementFallbackOnServerError === true)) {
        this.args.logger?.("whatsapp_channel_mandate_resolution_fallback", {
          protocol_subject_header: input.protocolSubjectHeader,
          resource: input.resource,
          plan: input.plan,
          status: response.status,
        })
        return new EntitlementBackedMandateResolver({
          baseUrl: this.args.baseUrl,
          tenantToken: this.args.tenantToken,
          channelUrl: this.args.channelUrl,
          logger: this.args.logger,
        }).resolve(input)
      }
      throw new Error(
        `whatsapp_channel_mandate_resolve_failed:${response.status}:${JSON.stringify(body).slice(0, 300)}`,
      )
    }

    const record = normalizeResolveResponse(body, input)
    const state = inferState(record)
    this.args.logger?.("whatsapp_channel_mandate_resolution", {
      protocol_subject_header: input.protocolSubjectHeader,
      resource: input.resource,
      plan: input.plan,
      state,
      expires_at: record.expires_at || null,
      payment_url: record.payment_url || null,
      source: "channel_access_resolve",
    })

    return {
      state,
      protocolSubjectHeader: input.protocolSubjectHeader,
      resource: record.resource,
      anchorResource: record.anchor_resource,
      plan: record.plan,
      ...(record.expires_at ? { expiresAt: record.expires_at } : {}),
      ...(record.payment_url ? { paymentUrl: record.payment_url } : {}),
      ...(this.args.channelUrl !== undefined ? { channelUrl: this.args.channelUrl } : {}),
      ...(record.reason ? { reason: record.reason } : {}),
      runtimeConfig: record.runtime_config,
      capabilities: record.capabilities,
      source: "channel_access_resolve",
    }
  }
}

function inferState(record: ChannelAccessResolveResponse): ChannelMandateResolution["state"] {
  return record.state
}

function normalizeResolveResponse(
  body: unknown,
  input: { resource: string; plan: string },
): ChannelAccessResolveResponse {
  const record = body && typeof body === "object" ? (body as Record<string, unknown>) : {}
  return {
    ok: record.ok !== false,
    state: normalizeState(record.state),
    resource: readString(record.resource) || input.resource,
    anchor_resource: readString(record.anchor_resource) || readString(record.resource) || input.resource,
    plan: readString(record.plan) || input.plan,
    expires_at: readString(record.expires_at) || null,
    payment_url: readString(record.payment_url) || null,
    reason: readString(record.reason) || null,
    runtime_config: readRuntimeConfig(record.runtime_config),
    capabilities: readCapabilities(record.capabilities),
  }
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

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined
}

function normalizeState(value: unknown): ChannelAccessResolveResponse["state"] {
  const v = readString(value)
  if (v === "paid_active" || v === "trial_active" || v === "expired_payment_required" || v === "inactive") {
    return v
  }
  return "inactive"
}

function readCapabilities(value: unknown): ChannelAccessResolveResponse["capabilities"] {
  const record = value && typeof value === "object" ? (value as Record<string, unknown>) : {}
  return {
    channel_access_version: readString(record.channel_access_version) || "1",
    ...record,
  }
}

function readRuntimeConfig(value: unknown): ChannelAccessResolveResponse["runtime_config"] {
  if (!value || typeof value !== "object") return null
  const record = value as Record<string, unknown>
  const mode = readString(record.mode)
  const channel = readString(record.channel)
  const channelKind = readString(record.channel_kind)
  if ((mode !== "human" && mode !== "agent") || !channel || !channelKind) return null
  const soul = readSoulConfig(record.soul)
  return {
    mode,
    channel,
    channel_kind: channelKind,
    provider: readString(record.provider) || null,
    channel_app_id: readString(record.channel_app_id) || null,
    visit_url: readString(record.visit_url) || null,
    human_routing: asRecord(record.human_routing),
    agent_routing: asRecord(record.agent_routing),
    fallback: readFallback(record.fallback),
    soul,
  }
}

function readSoulConfig(value: unknown) {
  if (!value || typeof value !== "object") return null
  const record = value as Record<string, unknown>
  const id = record.id
  const slug = readString(record.slug)
  const name = readString(record.name)
  const version = record.version
  if ((typeof id !== "number" && typeof id !== "string") || !slug || !name || (typeof version !== "number" && typeof version !== "string")) {
    return null
  }
  return {
    id,
    slug,
    name,
    version,
    capabilities: asRecord(record.capabilities),
    tool_policy: asRecord(record.tool_policy),
    memory_policy: asRecord(record.memory_policy),
    compiled_prompt_artifacts: asRecord(record.compiled_prompt_artifacts),
  }
}

function readFallback(value: unknown) {
  if (!value || typeof value !== "object") return null
  const record = value as Record<string, unknown>
  return record.allowed === true && readString(record.mode) === "human"
    ? { allowed: true, mode: "human" as const }
    : null
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null
}

function shouldFallback(status: number, body: unknown, allowServerErrorFallback: boolean): boolean {
  if (status === 404 || status === 501 || status === 503) return true
  const errorCode =
    body && typeof body === "object" ? readString((body as Record<string, unknown>).error) : undefined
  if (errorCode === "channel_access_not_available") return true
  if (allowServerErrorFallback && status >= 500) return true
  return false
}
