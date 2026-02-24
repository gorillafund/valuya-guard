// packages/core/src/v2/protocol/payment.ts

export type PaymentInstruction =
  | {
      method: "onchain"
      currency: string
      token: string
      chain_id: number
      to_address: string
      amount_raw: string
      decimals: number
      token_address: string
      is_free?: false
    }
  | {
      method: "fiat"
      currency: string
      iban: string
      bic?: string
      recipient_name?: string
      memo?: string
      amount: string
      is_free?: false
    }
  | {
      method: "free"
      currency?: string
      is_free: true
      reason?: string
    }
