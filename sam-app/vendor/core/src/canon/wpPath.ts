// packages/core/src/v2/canon/wpPath.ts

/**
 * Mirrors Laravel:
 * - ProductResolver::normalizePath()
 * - ResourceKey::wpPath() / api()
 *
 * - strips query/fragment (PHP parse_url(PHP_URL_PATH) behavior)
 * - ensures leading slash
 * - ensures trailing slash
 * - collapses multiple slashes
 */
export function normalizePathLikeBackend(input: string): string {
  let p = String(input ?? "").trim()

  // emulate PHP parse_url($x, PHP_URL_PATH) ?: $x
  // - if input is full URL, use pathname
  // - otherwise strip ?/# manually
  try {
    if (/^https?:\/\//i.test(p)) {
      const u = new URL(p)
      p = u.pathname || p
    } else {
      const q = p.indexOf("?")
      const h = p.indexOf("#")
      const cut = q === -1 ? h : h === -1 ? q : Math.min(q, h)
      if (cut !== -1) p = p.slice(0, cut)
    }
  } catch {
    // ignore parse errors, continue with raw string
  }

  p = String(p ?? "").trim()
  if (p === "") p = "/"

  if (!p.startsWith("/")) p = "/" + p
  if (!p.endsWith("/")) p = p + "/"

  p = p.replace(/\/+/g, "/")
  return p
}

export function canonicalizeWpPathResource(resource: string): string {
  const r = String(resource ?? "").trim()
  if (!r.startsWith("wp:path:")) return r
  const raw = r.slice("wp:path:".length)
  return "wp:path:" + normalizePathLikeBackend(raw)
}
