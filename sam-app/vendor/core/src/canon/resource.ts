export type RequestedResource = string & {
  readonly __brand: "RequestedResource"
}
export type AnchorResourceKey = string & {
  readonly __brand: "AnchorResourceKey"
}

const NS_RE = /^[a-z][a-z0-9_-]*$/
const TYPE_RE = /^[a-z][a-z0-9_-]*$/

function isCanonicalLike(value: unknown): value is string {
  if (typeof value !== "string") return false
  const first = value.indexOf(":")
  if (first <= 0) return false
  const second = value.indexOf(":", first + 1)
  if (second <= first + 1) return false

  const ns = value.slice(0, first)
  const type = value.slice(first + 1, second)
  const ident = value.slice(second + 1)

  if (!NS_RE.test(ns)) return false
  if (!TYPE_RE.test(type)) return false
  if (!ident) return false
  if (/\s/.test(ident)) return false
  return true
}

export function asRequestedResource(v: string): RequestedResource {
  if (!isCanonicalLike(v)) throw new Error(`Invalid RequestedResource: ${v}`)
  return v as RequestedResource
}

export function asAnchorResourceKey(v: string): AnchorResourceKey {
  if (!isCanonicalLike(v)) throw new Error(`Invalid AnchorResourceKey: ${v}`)
  return v as AnchorResourceKey
}

export function parseResource(r: string): {
  namespace: string
  type: string
  identifier: string
} {
  const first = r.indexOf(":")
  const second = r.indexOf(":", first + 1)
  return {
    namespace: r.slice(0, first),
    type: r.slice(first + 1, second),
    identifier: r.slice(second + 1),
  }
}

export function makeResource(args: {
  namespace: string
  type: string
  identifier: string
}): string {
  const { namespace, type, identifier } = args
  if (!NS_RE.test(namespace)) throw new Error(`Invalid namespace: ${namespace}`)
  if (!TYPE_RE.test(type)) throw new Error(`Invalid type: ${type}`)
  if (!identifier || /\s/.test(identifier))
    throw new Error(`Invalid identifier: ${identifier}`)
  return `${namespace}:${type}:${identifier}`
}
