// packages/core/src/v2/protocol/responses.ts

import type { GuardRequired } from "./required.js"
import type { PaymentInstruction } from "./payment.js"

export type PaymentRequiredBodyV2 = {
  error: "payment_required"
  reason: string
  required: GuardRequired
  evaluated_plan: string

  // IMPORTANT: this is the *requested* resource (what client asked for)
  // The server will resolve anchor_resource internally.
  resource: string

  session_id: string
  payment_url: string

  payment?: PaymentInstruction
}

export type PaymentRequiredResponseV2 = {
  status: 402
  headers: Record<string, string>
  body: string
}

export function paymentRequiredResponseV2(args: {
  reason: string
  required: GuardRequired
  evaluated_plan: string
  resource: string
  payment_url: string
  session_id: string
  payment?: PaymentInstruction
}): PaymentRequiredResponseV2 {
  const bodyObj: PaymentRequiredBodyV2 = {
    error: "payment_required",
    reason: args.reason,
    required: args.required,
    evaluated_plan: args.evaluated_plan,
    resource: args.resource,
    session_id: args.session_id,
    payment_url: args.payment_url,
    ...(args.payment ? { payment: args.payment } : {}),
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Access-Control-Expose-Headers":
      "X-Valuya-Payment-Url, X-Valuya-Session-Id",
    "X-Valuya-Payment-Url": args.payment_url,
    "X-Valuya-Session-Id": args.session_id,
  }

  return { status: 402, headers, body: JSON.stringify(bodyObj) }
}
