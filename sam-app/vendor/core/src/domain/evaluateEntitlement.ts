import type { CanonicalSubjectV2 } from "../canon/subject.js"
import type { AnchorResourceKey } from "../canon/resource.js"
import type { GuardRequired } from "../protocol/required.js"
import type { Mandate } from "./mandateMatch.js"
import { findValidMandate } from "./mandateMatch.js"

export type DomainEntitlementReason =
  | "subscription_inactive"
  | "subject_missing"
  | "resource_invalid"
  | "internal_error"

export type DomainEntitlementDecision =
  | {
      active: true
      evaluated_plan: string
      expires_at?: string
      mandate_id?: string
    }
  | {
      active: false
      reason: DomainEntitlementReason
      required: GuardRequired
      evaluated_plan: string
      anchor_resource: AnchorResourceKey
      subject?: CanonicalSubjectV2 | null
    }

export function evaluateEntitlement(args: {
  subject: CanonicalSubjectV2 | null
  anchor_resource: AnchorResourceKey
  required: GuardRequired
  evaluated_plan: string
  mandates: Mandate[]
  nowMs: number
  walletAddress?: string
}): DomainEntitlementDecision {
  const {
    subject,
    anchor_resource,
    required,
    evaluated_plan,
    mandates,
    nowMs,
    walletAddress,
  } = args

  if (!subject) {
    return {
      active: false,
      reason: "subject_missing",
      required,
      evaluated_plan,
      anchor_resource,
      subject: null,
    }
  }

  const m = findValidMandate(mandates, {
    subject,
    anchor_resource,
    required,
    nowMs,
    walletAddress,
  })
  if (!m) {
    return {
      active: false,
      reason: "subscription_inactive",
      required,
      evaluated_plan,
      anchor_resource,
      subject,
    }
  }

  const expires_at =
    typeof m.expires_at === "number"
      ? new Date(m.expires_at).toISOString()
      : undefined

  return { active: true, evaluated_plan, expires_at, mandate_id: m.id }
}
