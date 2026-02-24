// packages/core/src/v2/protocol/required.ts

/**
 * v2 wire contract for GuardRequired.
 * Authoritative declaration of what is required to access a resource.
 */

export type Money = {
  amount: string // decimal string
  currency: string // "EUR", "USD", ...
}

export type ISO8601Duration = string // e.g. "P1M", "P1Y", "PT24H"

export type GuardRequired =
  | {
      type: "subscription"
      plan: string
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
        price?: Money
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
