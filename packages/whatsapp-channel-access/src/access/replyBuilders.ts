import {
  buildAllowedAccessReply as buildAllowedAccessReplyCore,
  buildRuntimeErrorReply as buildRuntimeErrorReplyCore,
} from "@valuya/channel-access-core"
import type { WhatsAppChannelAccessDecision } from "../domain/types.js"

export function buildBlockedAccessReply(decision: WhatsAppChannelAccessDecision & { allowed: false }): string {
  switch (decision.state) {
    case "not_linked":
      return decision.reply
    case "expired_payment_required":
      return [
        decision.reply,
        decision.expiresAt ? `Freier Zugang endete am ${decision.expiresAt}.` : null,
        decision.paymentUrl ? `Zahlungslink: ${decision.paymentUrl}` : null,
      ].filter(Boolean).join("\n")
    case "inactive":
      return [
        decision.reply,
        decision.paymentUrl ? `Zahlungslink: ${decision.paymentUrl}` : null,
      ].filter(Boolean).join("\n")
    case "guard_unavailable":
    default:
      return decision.reply
  }
}

export function buildHumanHandoffReply(): string {
  return "Dein Zugang ist aktiv. Deine Nachricht wurde an den menschlichen Kanal weitergegeben."
}

export function buildAllowedAccessReply(args: {
  visitUrl?: string | null
  state: "paid_active" | "trial_active"
  expiresAt?: string
}): string {
  return buildAllowedAccessReplyCore({ ...args, language: "de" })
}

export function buildRuntimeErrorReply(error: "runtime_missing" | "agent_misconfigured"): string {
  return buildRuntimeErrorReplyCore(error, "de")
}
