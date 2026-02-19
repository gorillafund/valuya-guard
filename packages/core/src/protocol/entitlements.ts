import type { AnchorResourceKey } from "../canon/resource.js"
import type { GuardRequired } from "./required.js"

export type EntitlementReason =
  | "subscription_inactive"
  | "subject_missing"
  | "resource_invalid"
  | "internal_error"

export type EntitlementDecision =
  | {
      active: true
      evaluated_plan: string
      expires_at?: string
      mandate_id?: string | number
      remaining_quantity?: number | null
      quantity_total?: number | null
      quantity_used?: number | null
    }
  | {
      active: false
      reason: EntitlementReason
      required: GuardRequired
      evaluated_plan: string
      anchor_resource: AnchorResourceKey
      subject?: { type: string; id: string } | null
    }

export type EntitlementsResponse = EntitlementDecision
