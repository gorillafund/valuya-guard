import type { CanonicalSubjectV2 } from "../canon/subject.js"
import { canonicalizeWalletAddress } from "../canon/subject.js"
import type { AnchorResourceKey } from "../canon/resource.js"
import type { GuardRequired, ISO8601Duration } from "../protocol/required.js"

export type MandateEntitlement =
  | { type: "subscription"; plan: string }
  | { type: "seat_subscription"; plan: string }
  | { type: "trial"; plan: string; duration: ISO8601Duration }
  | {
      type: "one_time"
      sku?: string
      access_duration?: ISO8601Duration | "lifetime"
    }
  | { type: "time_pass"; duration: ISO8601Duration }
  | { type: "per_call"; unit?: string }
  | { type: "usage_cap"; unit: string; window: ISO8601Duration }
  | { type: "prepaid_credits"; credit_unit: string }
  | { type: "bundle"; unit: string; quantity: number }
  | { type: "metered_tiered"; unit: string; window: ISO8601Duration }
  | { type: "deposit"; refundable: boolean }
  | { type: "revenue_share" }

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
      const _x: never = required
      return _x
    }
  }
}

export type Mandate = {
  id: string
  subject: CanonicalSubjectV2
  resource: AnchorResourceKey
  created_at: number
  valid_from?: number
  expires_at?: number
  entitlement: MandateEntitlement
  conditions?: { wallet_allowlist?: string[] }
}

export function isMandateActive(m: Mandate, nowMs: number): boolean {
  if (typeof m.valid_from === "number" && nowMs < m.valid_from) return false
  if (typeof m.expires_at === "number" && nowMs >= m.expires_at) return false
  return true
}

function entitlementMatches(
  m: MandateEntitlement,
  r: MandateEntitlement,
): boolean {
  if (m.type !== r.type) return false
  switch (m.type) {
    case "subscription":
    case "seat_subscription":
      return m.plan === (r as any).plan
    case "trial":
      return m.plan === (r as any).plan && m.duration === (r as any).duration
    case "time_pass":
      return m.duration === (r as any).duration
    case "usage_cap":
    case "metered_tiered":
      return m.unit === (r as any).unit && m.window === (r as any).window
    case "prepaid_credits":
      return m.credit_unit === (r as any).credit_unit
    case "bundle":
      return m.unit === (r as any).unit && m.quantity === (r as any).quantity
    case "one_time":
      return (
        (m.sku ?? null) === ((r as any).sku ?? null) &&
        (m.access_duration ?? null) === ((r as any).access_duration ?? null)
      )
    case "per_call":
      return (m.unit ?? null) === ((r as any).unit ?? null)
    case "deposit":
      return m.refundable === (r as any).refundable
    case "revenue_share":
      return true
  }
}

export function mandateMatches(
  m: Mandate,
  args: {
    subject: CanonicalSubjectV2
    anchor_resource: AnchorResourceKey
    required: GuardRequired
    nowMs: number
    walletAddress?: string
  },
): boolean {
  const { subject, anchor_resource, required, nowMs, walletAddress } = args
  if (!isMandateActive(m, nowMs)) return false
  if (m.resource !== anchor_resource) return false
  if (m.subject.type !== subject.type) return false
  if (m.subject.id !== subject.id) return false
  if (!entitlementMatches(m.entitlement, entitlementFromRequired(required)))
    return false

  const allow = m.conditions?.wallet_allowlist
  if (allow && allow.length > 0) {
    if (!walletAddress) return false
    const w = canonicalizeWalletAddress(walletAddress)
    const normalized = allow.map(canonicalizeWalletAddress)
    if (!normalized.includes(w)) return false
  }
  return true
}

export function findValidMandate(
  mandates: Mandate[],
  args: {
    subject: CanonicalSubjectV2
    anchor_resource: AnchorResourceKey
    required: GuardRequired
    nowMs: number
    walletAddress?: string
  },
): Mandate | null {
  let best: Mandate | null = null
  for (const m of mandates) {
    if (!mandateMatches(m, args)) continue
    if (!best || (m.created_at ?? 0) > (best.created_at ?? 0)) best = m
  }
  return best
}
