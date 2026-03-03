// @ts-nocheck
import fs from "node:fs"
import path from "node:path"

const REPO_ROOT = process.cwd()
const OPENAPI_PATH = path.join(REPO_ROOT, "openapi", "v2.yaml")
const RFC_FILE_RE = /^RFC_.*\.md$/
const LEGACY_RFC_EXCLUDE = new Set([
  "RFC_PRODUCT_CREATION_API.md",
])

const LEGACY_ALIASES: Record<string, string> = {
  "/api/v2/entitlements/check": "/api/v2/entitlements",
}

function listRfcFiles(): string[] {
  const files = fs.readdirSync(REPO_ROOT)
  return files
    .filter((f) => RFC_FILE_RE.test(f))
    .filter((f) => !LEGACY_RFC_EXCLUDE.has(f))
    .sort()
}

function normalizeEndpoint(raw: string): string {
  let out = raw.trim()
  if (LEGACY_ALIASES[out]) out = LEGACY_ALIASES[out]

  // Normalize parameter token names so {sessionId} and {session_id} compare equal.
  out = out.replace(/\{[^}]+\}/g, "{param}")
  return out
}

function extractOpenApiPaths(source: string): Set<string> {
  const paths = new Set<string>()
  const pathLineRe = /^  (\/api\/v2\/[^:]+):\s*$/gm

  let m: RegExpExecArray | null
  while ((m = pathLineRe.exec(source)) !== null) {
    paths.add(normalizeEndpoint(m[1]))
  }

  return paths
}

function extractEndpointsFromMarkdown(md: string): string[] {
  const endpointRe = /(\/api\/v2\/[A-Za-z0-9_\-\/.{}]+)/g
  const out = new Set<string>()

  let m: RegExpExecArray | null
  while ((m = endpointRe.exec(md)) !== null) {
    out.add(m[1].replace(/[),.;:]+$/, ""))
  }

  return [...out].sort()
}

function main(): void {
  if (!fs.existsSync(OPENAPI_PATH)) {
    throw new Error(`OpenAPI file not found: ${OPENAPI_PATH}`)
  }

  const openapi = fs.readFileSync(OPENAPI_PATH, "utf8")
  const openApiPaths = extractOpenApiPaths(openapi)
  const rfcFiles = listRfcFiles()

  if (rfcFiles.length === 0) {
    throw new Error("No RFC markdown files found (expected RFC_*.md in repo root)")
  }

  const errors: string[] = []

  for (const file of rfcFiles) {
    const abs = path.join(REPO_ROOT, file)
    const md = fs.readFileSync(abs, "utf8")
    const endpoints = extractEndpointsFromMarkdown(md)

    for (const ep of endpoints) {
      const normalized = normalizeEndpoint(ep)
      if (!openApiPaths.has(normalized)) {
        errors.push(`${file}: endpoint not found in OpenAPI -> ${ep}`)
      }
    }
  }

  if (errors.length > 0) {
    const lines = [
      "RFC consistency check failed. The following RFC endpoints are missing from openapi/v2.yaml:",
      ...errors.map((e) => `- ${e}`),
    ]
    throw new Error(lines.join("\n"))
  }

  console.log(`RFC consistency check passed across ${rfcFiles.length} RFC file(s).`)
}

main()
