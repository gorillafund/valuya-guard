// @ts-nocheck
import fs from "node:fs"
import path from "node:path"

const REPO_ROOT = process.cwd()
const OPENAPI_PATH = path.join(REPO_ROOT, "openapi", "v2.yaml")
const SNAPSHOT_PATH = path.join(REPO_ROOT, "docs", "protocol", "snapshot.generated.md")

const TARGET_EXACT = new Set([
  "/api/v2/entitlements",
  "/api/v2/checkout/sessions",
])
const TARGET_PREFIX = "/api/v2/agent/products/"

type EndpointInfo = {
  method: string
  path: string
  requiredHeaders: string[]
  schemaRefs: string[]
}

function extractOpenApiPathBlocks(source: string): Map<string, string[]> {
  const lines = source.split(/\r?\n/)
  const blocks = new Map<string, string[]>()

  let inPaths = false
  let currentPath: string | null = null
  let currentLines: string[] = []

  for (const line of lines) {
    if (!inPaths) {
      if (/^paths:\s*$/.test(line)) {
        inPaths = true
      }
      continue
    }

    if (/^components:\s*$/.test(line)) {
      break
    }

    const pathMatch = line.match(/^  (\/api\/v2\/[^:]+):\s*$/)
    if (pathMatch) {
      if (currentPath) {
        blocks.set(currentPath, currentLines)
      }
      currentPath = pathMatch[1]
      currentLines = []
      continue
    }

    if (currentPath) {
      currentLines.push(line)
    }
  }

  if (currentPath) {
    blocks.set(currentPath, currentLines)
  }

  return blocks
}

function parseEndpointMethods(pathKey: string, blockLines: string[]): EndpointInfo[] {
  const endpoints: EndpointInfo[] = []

  let currentMethod: string | null = null
  let methodLines: string[] = []

  const flush = () => {
    if (!currentMethod) return
    endpoints.push({
      method: currentMethod.toUpperCase(),
      path: pathKey,
      requiredHeaders: extractRequiredHeaders(methodLines),
      schemaRefs: extractSchemaRefs(methodLines),
    })
    currentMethod = null
    methodLines = []
  }

  for (const line of blockLines) {
    const methodMatch = line.match(/^    (get|post|put|patch|delete|options|head):\s*$/)
    if (methodMatch) {
      flush()
      currentMethod = methodMatch[1]
      continue
    }

    if (currentMethod) {
      methodLines.push(line)
    }
  }

  flush()
  return endpoints
}

function extractRequiredHeaders(lines: string[]): string[] {
  const headers: string[] = []

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]
    if (!/^\s*- in: header\s*$/.test(line)) continue

    let name = ""
    let required = false
    let j = i + 1
    for (; j < lines.length; j += 1) {
      const next = lines[j]
      if (/^\s*- /.test(next)) break
      if (/^\s*responses:\s*$/.test(next)) break
      if (/^\s*requestBody:\s*$/.test(next)) break
      const nameMatch = next.match(/^\s*name: ([^\s]+)\s*$/)
      if (nameMatch) name = nameMatch[1]
      if (/^\s*required: true\s*$/.test(next)) required = true
    }

    if (name && required) {
      headers.push(name)
    }
    i = j - 1
  }

  return [...new Set(headers)].sort()
}

function extractSchemaRefs(lines: string[]): string[] {
  const refs = new Set<string>()
  const refRe = /\$ref:\s*['"]?([^'"\s]+)['"]?/g

  for (const line of lines) {
    let m: RegExpExecArray | null
    while ((m = refRe.exec(line)) !== null) {
      refs.add(m[1])
    }
  }

  return [...refs].sort()
}

function isTargetPath(pathKey: string): boolean {
  if (TARGET_EXACT.has(pathKey)) return true
  return pathKey.startsWith(TARGET_PREFIX)
}

function generateMarkdown(endpoints: EndpointInfo[]): string {
  const out: string[] = []

  out.push("# Protocol Snapshot (Generated)")
  out.push("")
  out.push("## Endpoints")
  for (const ep of endpoints) {
    out.push(`- \`${ep.method} ${ep.path}\``)
  }

  out.push("")
  out.push("## Details")
  for (const ep of endpoints) {
    out.push("")
    out.push(`### \`${ep.method} ${ep.path}\``)

    out.push("Required headers:")
    if (ep.requiredHeaders.length === 0) {
      out.push("- (none)")
    } else {
      for (const h of ep.requiredHeaders) out.push(`- \`${h}\``)
    }

    out.push("Schema references:")
    if (ep.schemaRefs.length === 0) {
      out.push("- (none)")
    } else {
      for (const ref of ep.schemaRefs) out.push(`- \`${ref}\``)
    }
  }

  out.push("")
  return out.join("\n")
}

function main(): void {
  if (!fs.existsSync(OPENAPI_PATH)) {
    throw new Error(`OpenAPI file not found: ${OPENAPI_PATH}`)
  }

  const source = fs.readFileSync(OPENAPI_PATH, "utf8")
  const pathBlocks = extractOpenApiPathBlocks(source)

  const endpoints: EndpointInfo[] = []
  for (const [pathKey, blockLines] of pathBlocks.entries()) {
    if (!isTargetPath(pathKey)) continue
    endpoints.push(...parseEndpointMethods(pathKey, blockLines))
  }

  endpoints.sort((a, b) => {
    const pathCmp = a.path.localeCompare(b.path)
    if (pathCmp !== 0) return pathCmp
    return a.method.localeCompare(b.method)
  })

  const generated = generateMarkdown(endpoints)
  const hadSnapshot = fs.existsSync(SNAPSHOT_PATH)
  const previous = hadSnapshot ? fs.readFileSync(SNAPSHOT_PATH, "utf8") : ""

  fs.mkdirSync(path.dirname(SNAPSHOT_PATH), { recursive: true })
  fs.writeFileSync(SNAPSHOT_PATH, generated, "utf8")

  if (!hadSnapshot) {
    throw new Error(
      `Protocol snapshot did not exist. Generated ${path.relative(REPO_ROOT, SNAPSHOT_PATH)}. Commit this file.`,
    )
  }

  if (previous !== generated) {
    throw new Error(
      `Protocol snapshot drift detected in ${path.relative(REPO_ROOT, SNAPSHOT_PATH)}. Commit regenerated snapshot.`,
    )
  }

  console.log(`Protocol snapshot is up to date: ${path.relative(REPO_ROOT, SNAPSHOT_PATH)}`)
}

main()
