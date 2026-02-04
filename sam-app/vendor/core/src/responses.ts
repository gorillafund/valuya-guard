// packages/core/src/responses.js

import { GuardRequired, PaymentInstruction } from "./types.js"
import { CanonicalResource } from "./resource.js"

export type PaymentRequiredResponseBody = {
  error: "payment_required"
  reason: string
  required: GuardRequired
  evaluated_plan: string
  resource: CanonicalResource
  session_id: string
  payment_url: string
  payment?: PaymentInstruction
}

export type PaymentRequiredResponse = {
  status: 402
  headers: Record<string, string>
  body: string // JSON
}

export function paymentRequiredResponse(args: {
  reason: string
  required: GuardRequired
  evaluatedPlan: string
  resource: CanonicalResource
  paymentUrl: string
  sessionId: string
  payment?: PaymentInstruction
}): PaymentRequiredResponse {
  const bodyObj: PaymentRequiredResponseBody = {
    error: "payment_required",
    reason: args.reason,
    required: args.required,
    evaluated_plan: args.evaluatedPlan,
    resource: args.resource,
    session_id: args.sessionId,
    payment_url: args.paymentUrl,
    ...(args.payment ? { payment: args.payment } : {}),
  }

  const headers: Record<string, string> = {
    // RFC-exact casing:
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Access-Control-Expose-Headers":
      "X-Valuya-Payment-Url, X-Valuya-Session-Id",
    "X-Valuya-Payment-Url": args.paymentUrl,
    "X-Valuya-Session-Id": args.sessionId,
  }

  return {
    status: 402,
    headers,
    body: JSON.stringify(bodyObj),
  }
}
