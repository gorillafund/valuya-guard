// packages/core/src/v2/protocol/mandates.ts

import type { AnchorResourceKey } from "../canon/resource.js"
import type { MandateEntitlement } from "../domain/mandateMatch.js"

/**
 * v2 mandate wire contract.
 * IMPORTANT: resource MUST be anchor_resource key.
 */

export type MandateV2 = {
  id: string | number

  subject: { type: string; id: string }

  // ✅ anchor key
  resource: AnchorResourceKey

  created_at: number // ms since epoch

  valid_from?: number
  expires_at?: number

  entitlement: MandateEntitlement

  // quantity-based usage entitlements (optional but supported)
  quantity_total?: number | null
  quantity_used?: number | null

  pricing_hash?: string
  pricing_type?: string
  pricing_version?: number

  conditions?: {
    // optional client-side check; server remains source of truth
    wallet_allowlist?: string[]
  }

  payment?: {
    session_id: string
    method: "onchain" | "stripe" | "fiat" | "other" | "free"
    amount_raw?: string
    currency?: string
    chain_id?: number
    from_address?: string
    to_address?: string
    tx_hash?: string
  }
}
