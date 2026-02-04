// packages/core/src/mandates.js

import { CanonicalSubject, canonicalizeWalletAddress } from "../subject.js"
import { CanonicalResource } from "../resource.js"
import { GuardRequired, ISO8601Duration } from "../types.js"
import { entitlementFromRequired } from "./entitlements.js"

export type Mandate = {
  id: string
  subject: CanonicalSubject
  resource: string
  created_at: number
  valid_from?: number
  expires_at?: number
  entitlement: MandateEntitlement
  conditions?: {
    wallet_allowlist?: string[]
  }
  payment?: {
    session_id: string
    method: "onchain" | "stripe" | "other"
    amount_raw?: string
    currency?: string
    chain_id?: number
    from_address?: string
    to_address?: string
    tx_hash?: string
  }
}

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
  | { type: "per_call"; unit?: string } // per-call mandates are often short-lived
  | { type: "usage_cap"; unit: string; window: ISO8601Duration }
  | { type: "prepaid_credits"; credit_unit: string }
  | { type: "bundle"; unit: string; quantity: number }
  | { type: "metered_tiered"; unit: string; window: ISO8601Duration }
  | { type: "deposit"; refundable: boolean }
  | { type: "revenue_share" }

export function isMandateActive(m: Mandate, nowMs: number): boolean {
  if (typeof m.valid_from === "number" && nowMs < m.valid_from) return false
  if (typeof m.expires_at === "number" && nowMs >= m.expires_at) return false
  return true
}

export function mandateMatches(
  m: Mandate,
  args: {
    subject: CanonicalSubject
    resource: CanonicalResource
    required: GuardRequired
    evaluatedPlan: string
    nowMs: number
    walletAddress?: string
  },
): boolean {
  const { subject, resource, required, evaluatedPlan, nowMs, walletAddress } =
    args

  if (!isMandateActive(m, nowMs)) return false

  // Exact match — deterministic, no wildcards
  if (m.resource !== resource) return false
  if (m.subject?.type !== subject.type) return false
  if (m.subject?.id !== subject.id) return false

  // Plan matching (subscription)
  const requiredEntitlement = entitlementFromRequired(required)

  if (!m.entitlement) return false // Option B strict
  if (!entitlementMatches(m.entitlement, requiredEntitlement)) return false

  // Wallet allowlist enforcement (agent payments support)
  const allowlist = m.conditions?.wallet_allowlist
  if (allowlist && allowlist.length > 0) {
    if (!walletAddress) return false
    const w = canonicalizeWalletAddress(walletAddress)
    const normalized = allowlist.map(canonicalizeWalletAddress)
    if (!normalized.includes(w)) return false
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
        // Choose a deterministic rule:
        // - If sku exists on both, must match
        // - If mandate has sku but required doesn't, allow? I'd say NO to avoid accidental unlocks.
        return (
          (m.sku ?? null) === ((r as any).sku ?? null) &&
          (m.access_duration ?? null) === ((r as any).access_duration ?? null)
        )

      case "per_call":
        // unit match if specified (avoid over-constraining)
        return (m.unit ?? null) === ((r as any).unit ?? null)

      case "deposit":
        return m.refundable === (r as any).refundable

      case "revenue_share":
        return true
    }
  }

  return true
}

export function findValidMandate(
  mandates: Mandate[],
  args: {
    subject: CanonicalSubject
    resource: CanonicalResource
    required: GuardRequired
    evaluatedPlan: string
    nowMs: number
    walletAddress?: string
  },
): Mandate | null {
  // deterministic selection rule:
  // choose the newest valid mandate (highest created_at)
  let best: Mandate | null = null
  for (const m of mandates) {
    if (!mandateMatches(m, args)) continue
    if (!best || (m.created_at ?? 0) > (best.created_at ?? 0)) best = m
  }
  return best
}

export function hasValidMandate(
  mandates: Mandate[],
  args: {
    subject: CanonicalSubject
    resource: CanonicalResource
    required: GuardRequired
    evaluatedPlan: string
    nowMs: number
    walletAddress?: string
  },
): boolean {
  return !!findValidMandate(mandates, args)
}
