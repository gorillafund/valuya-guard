export const PROTOCOL_VERSION_DATE = "2026-03-03" as const

export const SUBJECT_HEADER = "X-Valuya-Subject-Id" as const

export const ENDPOINTS = {
  entitlements: "/api/v2/entitlements",
  checkoutSessions: "/api/v2/checkout/sessions",
  checkoutSessionById: "/api/v2/checkout/sessions/{session_id}",
  agentProducts: "/api/v2/agent/products",
  agentProductsPrepare: "/api/v2/agent/products/prepare",
  agentProductsTypes: "/api/v2/agent/products/types",
  agentProductsSchema: "/api/v2/agent/products/schema/{type}",
  agentProductsResolve: "/api/v2/agent/products/resolve"
} as const
