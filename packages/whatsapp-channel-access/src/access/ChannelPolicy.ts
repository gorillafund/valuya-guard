import type { ChannelMandateResolution, WhatsAppChannelAccessDecision } from "../domain/types.js"

export function toAccessDecision(args: {
  linkedSubjectHeader: string | null
  resource: string
  plan: string
  resolution:
    | ChannelMandateResolution
    | {
        state: "not_linked" | "guard_unavailable"
        reply: string
        resource: string
        anchorResource: string
        plan: string
        paymentUrl?: string | null
        runtimeConfig?: null
        capabilities?: null
        source?: "linking"
      }
}): WhatsAppChannelAccessDecision {
  const resolution = args.resolution
  if (resolution.state === "trial_active" || resolution.state === "paid_active") {
    return {
      allowed: true,
      state: resolution.state,
      protocolSubjectHeader: resolution.protocolSubjectHeader,
      resource: resolution.resource,
      anchorResource: resolution.anchorResource,
      plan: resolution.plan,
      ...(resolution.expiresAt ? { expiresAt: resolution.expiresAt } : {}),
      ...(resolution.channelUrl !== undefined ? { channelUrl: resolution.channelUrl } : {}),
      runtimeConfig: resolution.runtimeConfig || null,
      capabilities: resolution.capabilities || null,
      source: resolution.source,
    }
  }

  return {
    allowed: false,
    state: resolution.state,
    protocolSubjectHeader: args.linkedSubjectHeader,
    resource: resolution.resource,
    anchorResource: resolution.anchorResource,
    plan: resolution.plan,
    reply: "reply" in resolution ? resolution.reply : "Channel access is currently unavailable.",
    ...("expiresAt" in resolution && resolution.expiresAt ? { expiresAt: resolution.expiresAt } : {}),
    ...("paymentUrl" in resolution ? { paymentUrl: resolution.paymentUrl || null } : {}),
    runtimeConfig: "runtimeConfig" in resolution ? resolution.runtimeConfig || null : null,
    capabilities: "capabilities" in resolution ? resolution.capabilities || null : null,
    source: ("source" in resolution ? resolution.source : undefined) || "linking",
  }
}
