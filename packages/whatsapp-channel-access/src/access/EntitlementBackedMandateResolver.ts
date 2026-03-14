import type { ChannelMandateResolver } from "./ChannelMandateResolver.js"
import type { ChannelMandateResolution, LegacyEntitlementResponse, LogFn } from "../domain/types.js"

export class EntitlementBackedMandateResolver implements ChannelMandateResolver {
  constructor(private readonly args: {
    baseUrl: string
    tenantToken: string
    channelUrl?: string | null
    logger?: LogFn
  }) {}

  async resolve(input: {
    protocolSubjectHeader: string
    resource: string
    plan: string
  }): Promise<ChannelMandateResolution> {
    const url = new URL(`${this.args.baseUrl}/api/v2/entitlements`)
    url.searchParams.set("resource", input.resource)
    url.searchParams.set("plan", input.plan)

    const response = await fetch(url.toString(), {
      method: "GET",
      headers: {
        Authorization: `Bearer ${this.args.tenantToken}`,
        Accept: "application/json",
        "X-Valuya-Subject-Id": input.protocolSubjectHeader,
      },
    })
    const body = await safeParseJson(response)
    if (!response.ok) {
      throw new Error(
        `whatsapp_channel_entitlement_failed:${response.status}:${JSON.stringify(body).slice(0, 300)}`,
      )
    }
    const record = body && typeof body === "object" ? body as LegacyEntitlementResponse : {}
    const state = inferState(record)
    this.args.logger?.("whatsapp_channel_mandate_resolution", {
      protocol_subject_header: input.protocolSubjectHeader,
      resource: input.resource,
      plan: input.plan,
      state,
      expires_at: readString(record.expires_at) || null,
    })
    return {
      state,
      protocolSubjectHeader: input.protocolSubjectHeader,
      resource: input.resource,
      anchorResource: input.resource,
      plan: input.plan,
      ...(readString(record.expires_at) ? { expiresAt: readString(record.expires_at) } : {}),
      ...(readString(record.payment_url) ? { paymentUrl: readString(record.payment_url) } : {}),
      ...(this.args.channelUrl !== undefined ? { channelUrl: this.args.channelUrl } : {}),
      ...(readString(record.reason) ? { reason: readString(record.reason) } : {}),
      capabilities: { channel_access_version: "fallback-entitlements" },
      runtimeConfig: null,
      source: "entitlements_fallback",
    }
  }
}

function inferState(record: LegacyEntitlementResponse): ChannelMandateResolution["state"] {
  if (record.active === true) return "paid_active"
  const rawState = readString(record.state)
  if (rawState === "trial_active") return rawState
  return "inactive"
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
