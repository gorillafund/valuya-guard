// packages/core/src/resource.ts

/**
 * Canonical Resource (LOCKED)
 * Format: <namespace>:<type>:<identifier>
 *
 * Examples:
 *   http:route:GET:/api/v1/data
 *   wp:path:/premium/article-1/
 *   telegram:channel:-1001892349876
 *   file:download:/reports/q4.pdf
 *   superworld:geo:52.5200,13.4050:radius:30
 *
 * Notes:
 * - deterministic
 * - human-readable
 * - infrastructure-agnostic
 * - trailing slashes preserved where applicable (we do NOT normalize them away)
 */

export type CanonicalResource = string & {
  readonly __brand: "CanonicalResource"
}

// Strict but practical: namespace + type are tokens, identifier is "rest of string"
const NS_RE = /^[a-z][a-z0-9_-]*$/ // allow dash/underscore
const TYPE_RE = /^[a-z][a-z0-9_-]*$/

export function isCanonicalResource(
  value: unknown,
): value is CanonicalResource {
  if (typeof value !== "string") return false

  // Must have at least 2 colons separating namespace and type
  const first = value.indexOf(":")
  if (first <= 0) return false
  const second = value.indexOf(":", first + 1)
  if (second <= first + 1) return false

  const namespace = value.slice(0, first)
  const type = value.slice(first + 1, second)
  const identifier = value.slice(second + 1) // may contain colons and anything else

  if (!NS_RE.test(namespace)) return false
  if (!TYPE_RE.test(type)) return false

  // Identifier must be non-empty and must not contain whitespace
  if (!identifier) return false
  if (/\s/.test(identifier)) return false

  return true
}

export function asCanonicalResource(value: string): CanonicalResource {
  if (!isCanonicalResource(value)) {
    throw new Error(`Invalid CanonicalResource: ${value}`)
  }
  return value as CanonicalResource
}

/**
 * Build a CanonicalResource deterministically.
 * - namespace + type are validated tokens
 * - identifier is preserved exactly (no slash normalization)
 */
export function makeResource(args: {
  namespace: string
  type: string
  identifier: string
}): CanonicalResource {
  const { namespace, type, identifier } = args

  if (!NS_RE.test(namespace)) {
    throw new Error(`Invalid resource namespace: ${namespace}`)
  }
  if (!TYPE_RE.test(type)) {
    throw new Error(`Invalid resource type: ${type}`)
  }
  if (!identifier || /\s/.test(identifier)) {
    throw new Error(`Invalid resource identifier: ${identifier}`)
  }

  return `${namespace}:${type}:${identifier}` as CanonicalResource
}

/**
 * Parse a canonical resource into its components.
 * Identifier is "the rest" after the second colon (can contain colons).
 */
export function parseResource(resource: CanonicalResource): {
  namespace: string
  type: string
  identifier: string
} {
  const first = resource.indexOf(":")
  const second = resource.indexOf(":", first + 1)

  return {
    namespace: resource.slice(0, first),
    type: resource.slice(first + 1, second),
    identifier: resource.slice(second + 1),
  }
}

/**
 * Convenience helper: canonical http route resource.
 * Example: http:route:GET:/api/v1/data
 *
 * IMPORTANT:
 * - preserves path exactly (including trailing slash)
 * - does NOT try to decode/encode or normalize slashes
 */
export function httpRouteResource(
  method: string,
  path: string,
): CanonicalResource {
  const m = method.trim().toUpperCase()
  const p = path // preserve exactly per spec

  if (!m) throw new Error("HTTP method required")
  if (!p) throw new Error("HTTP path required")
  if (/\s/.test(p))
    throw new Error(`Invalid HTTP path (contains whitespace): ${p}`)

  return makeResource({
    namespace: "http",
    type: "route",
    identifier: `${m}:${p}`,
  })
}

export function tryAsCanonicalResource(
  value: string,
): { ok: true; value: CanonicalResource } | { ok: false; error: string } {
  try {
    return { ok: true, value: asCanonicalResource(value) }
  } catch (e: any) {
    return { ok: false, error: e?.message ?? "invalid_resource" }
  }
}
