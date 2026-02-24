export const KNOWN_BACKEND_ERROR_CODES = new Set([
  "tenant_token_required",
  "principal_not_bound",
  "subject_required",
  "invalid_product_ref",
  "product_not_found",
  "insufficient_scope",
])

export function backendErrorHint(code?: string | null): string | null {
  if (!code) return null
  if (!KNOWN_BACKEND_ERROR_CODES.has(code)) return null

  switch (code) {
    case "tenant_token_required":
      return "Set VALUYA_TENANT_TOKEN with a valid tenant/agent token."
    case "principal_not_bound":
      return "Token has no principal binding. Bind a subject to token or pass explicit subject in supported flows."
    case "subject_required":
      return "Resolved product requires a subject. Check whoami/principal mapping."
    case "invalid_product_ref":
      return "Use product ref format id:<n>, slug:<slug>, or external:<id>."
    case "product_not_found":
      return "Check product slug/id and tenant scope; try `agent:products:list --q <term>`."
    case "insufficient_scope":
      return "Token lacks required scope for this operation."
    default:
      return null
  }
}

