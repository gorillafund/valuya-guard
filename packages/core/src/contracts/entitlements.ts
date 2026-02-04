// packages/core/src/entitlements.js

import { CanonicalSubject } from "../subject.js"
import { CanonicalResource } from "../resource.js"
import { GuardRequired } from "../types.js"
import { Mandate, findValidMandate, MandateEntitlement } from "./mandates.js"

export type EntitlementsResponse = EntitlementDecision
export type EntitlementReason =
  | "subscription_inactive"
  | "subject_missing"
  | "resource_invalid"
  | "internal_error"

export type EntitlementDecision =
  | {
      active: true
      evaluated_plan: string
      expires_at?: string // ISO string if available
      mandate_id?: string
    }
  | {
      active: false
      reason: EntitlementReason
      required: GuardRequired
      evaluated_plan: string
      resource: CanonicalResource
      subject?: CanonicalSubject | null
    }

export function evaluateEntitlement(args: {
  subject: CanonicalSubject | null
  resource: CanonicalResource
  required: GuardRequired
  evaluatedPlan: string
  mandates: Mandate[]
  nowMs: number
  walletAddress?: string // for agent flows
}): EntitlementDecision {
  const {
    subject,
    resource,
    required,
    evaluatedPlan,
    mandates,
    nowMs,
    walletAddress,
  } = args

  if (!subject) {
    return {
      active: false,
      reason: "subject_missing",
      required,
      evaluated_plan: evaluatedPlan,
      resource,
      subject: null,
    }
  }

  const mandate = findValidMandate(mandates, {
    subject,
    resource,
    required,
    evaluatedPlan,
    nowMs,
    walletAddress,
  })

  if (!mandate) {
    return {
      active: false,
      reason: "subscription_inactive",
      required,
      evaluated_plan: evaluatedPlan,
      resource,
      subject,
    }
  }

  // Optional, deterministic enrichment:
  const expires_at =
    typeof mandate.expires_at === "number"
      ? new Date(mandate.expires_at).toISOString()
      : undefined

  return {
    active: true,
    evaluated_plan: evaluatedPlan,
    expires_at,
    mandate_id: mandate.id,
  }
}

export function entitlementFromRequired(
  required: GuardRequired,
): MandateEntitlement {
  switch (required.type) {
    case "subscription":
      return { type: "subscription", plan: required.plan }

    case "seat_subscription":
      return { type: "seat_subscription", plan: required.plan }

    case "trial":
      return { type: "trial", plan: required.plan, duration: required.duration }

    case "one_time":
      return {
        type: "one_time",
        sku: required.sku,
        access_duration: required.access_duration,
      }

    case "time_pass":
      return { type: "time_pass", duration: required.duration }

    case "per_call":
      return { type: "per_call", unit: required.unit }

    case "usage_cap":
      return { type: "usage_cap", unit: required.unit, window: required.window }

    case "prepaid_credits":
      return { type: "prepaid_credits", credit_unit: required.credit_unit }

    case "bundle":
      return {
        type: "bundle",
        unit: required.unit,
        quantity: required.quantity,
      }

    case "metered_tiered":
      return {
        type: "metered_tiered",
        unit: required.unit,
        window: required.window,
      }

    case "deposit":
      return { type: "deposit", refundable: required.refundable }

    case "revenue_share":
      return { type: "revenue_share" }

    default: {
      // Exhaustiveness guard
      const _exhaustive: never = required
      return _exhaustive
    }
  }
}
