import type { PaymentInstruction } from "@valuya/core"

export function isOnchainPayment(
  p: PaymentInstruction,
): p is Extract<PaymentInstruction, { method: "onchain" }> {
  return p.method === "onchain"
}
