// packages/core/src/types.ts

import type { CanonicalResource } from "./resource.ts"

/**
 * PaymentInstruction
 *
 * Optional machine-readable payment hint on 402.
 * Must align with RFC `payment` object.
 *
 * NOTE: This is a "hint" / instruction for the client-agent,
 * NOT an authorization primitive. Authorization is via Mandate only.
 */
export type PaymentInstruction =
  | {
      method: "onchain"
      currency: string // e.g. "EUR"
      token: string // e.g. "EURe"
      chain_id: number // e.g. 137
      to_address: string // treasury 0x...
      amount_raw: string // uint256 decimal string
      decimals: number // e.g. 18
      token_address?: string // optional but useful
    }
  | {
      method: "fiat"
      currency: string // e.g. "EUR"
      iban: string
      bic?: string
      recipient_name?: string
      memo?: string
      amount: string // e.g. "99.00"
    }

/**
 * GuardRequired
 *
 * Authoritative declaration of what is required to access a resource.
 * - Machine-actionable
 * - Deterministic
 * - Does NOT include payment mechanics (token, chain, checkout provider, etc.)
 *
 * IMPORTANT:
 * - `type` is the discriminator.
 * - Keep amounts as strings to avoid float issues.
 * - Use ISO-8601 durations for time-based requirements.
 */

export type Money = {
  amount: string // decimal string, e.g. "9.99", "0.10"
  currency: string // "EUR", "USD", "GBP", ...
}

export type ISO8601Duration = string // e.g. "P1M", "P1Y", "PT24H"

export type GuardRequired =
  | {
      type: "subscription"
      plan: string // e.g. "pro", "enterprise"
      period?: "day" | "week" | "month" | "year"
      trial?: { duration: ISO8601Duration }
      grace?: { duration: ISO8601Duration }
    }
  | {
      type: "seat_subscription"
      plan: string
      min_seats?: number
      max_seats?: number
      billing_unit?: "seat"
      period?: "month" | "year"
    }
  | {
      type: "one_time"
      sku?: string
      price?: Money
      access_duration?: ISO8601Duration | "lifetime"
    }
  | {
      type: "per_call"
      price: Money
      unit?: string
      min_quantity?: number
      max_quantity?: number
    }
  | {
      type: "usage_cap"
      cap: number
      unit: string
      window: ISO8601Duration
      overage?: {
        mode: "deny" | "payg" | "throttle"
        price?: Money // required if mode === "payg"
      }
    }
  | {
      type: "prepaid_credits"
      credit_unit: string
      cost_per_unit?: Money
      min_purchase?: number
      expires_after?: ISO8601Duration
    }
  | {
      type: "metered_tiered"
      unit: string
      window: ISO8601Duration
      tiers: Array<{
        up_to?: number
        price_per_unit: Money
      }>
      minimum?: Money
    }
  | {
      type: "time_pass"
      duration: ISO8601Duration
      price?: Money
    }
  | {
      type: "bundle"
      quantity: number
      unit: string
      price?: Money
      expires_after?: ISO8601Duration
    }
  | {
      type: "trial"
      plan: string
      duration: ISO8601Duration
      requires_payment_method?: boolean
    }
  | {
      type: "deposit"
      amount: Money
      refundable: boolean
      hold_duration?: ISO8601Duration
    }
  | {
      type: "revenue_share"
      rate_bps: number
      settlement_window?: ISO8601Duration
      minimum?: Money
    }

/**
 * PaymentRequiredBody (RFC shape)
 *
 * IMPORTANT:
 * - `required` is authoritative & machine-actionable.
 * - `evaluated_plan` is always present.
 * - `session_id` and `payment_url` are always present on deny.
 * - `payment` is optional.
 */
export type PaymentRequiredBody = {
  error: "payment_required"
  reason: string // e.g. "subscription_inactive"
  required: GuardRequired
  evaluated_plan: string
  resource: CanonicalResource

  session_id: string
  payment_url: string

  payment?: PaymentInstruction
}
