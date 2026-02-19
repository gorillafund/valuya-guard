// packages/core/src/v2/protocol/errors.ts

export type GuardErrorCode =
  | "tenant_token_required"
  | "insufficient_scope"
  | "subject_required"
  | "invalid_request"
  | "payment_required"
  | "session_not_found"
  | "session_expired"
  | "invalid_signature"
  | "wallet_not_allowlisted"
  | "tx_hash_reused"
  | "tx_hash_already_set"
  | "wallet_mismatch"
