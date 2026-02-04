import type { Subject } from "@valuya/core"

export type LambdaLikeResponse = {
  statusCode: number
  headers?: Record<string, string>
  body?: string
  isBase64Encoded?: boolean
}

export type LambdaHandler = (
  event: any,
  context: any,
) => Promise<LambdaLikeResponse> | LambdaLikeResponse

export type WithValuyaOptions = {
  // If omitted, adapter derives from request as http:route:METHOD:/path
  resource?: string

  plan?: string // default env.VALUYA_PLAN or "pro"
  subject?: (event: any) => Subject // override if you want

  valuyaBase?: string // default env.VALUYA_BASE
  tenanttoken?: string // default env.VALUYA_SITE_TOKEN

  // Optional URLs passed to checkout session creator:
  successUrl?: string
  cancelUrl?: string
}
