// @ts-nocheck
import fs from "node:fs"
import path from "node:path"
import { pathToFileURL } from "node:url"

const cwd = process.cwd()
const repoRoot = cwd.endsWith(path.join("packages", "protocol"))
  ? path.resolve(cwd, "..", "..")
  : cwd
const protocolDir = path.join(repoRoot, "packages", "protocol")
const protocolPkgJsonPath = path.join(protocolDir, "package.json")
const constantsModulePath = path.join(protocolDir, "dist", "constants.js")
const manifestPath = path.join(protocolDir, "dist", "manifest.json")

async function main(): Promise<void> {
  if (!fs.existsSync(protocolPkgJsonPath)) {
    throw new Error(`Missing protocol package.json: ${protocolPkgJsonPath}`)
  }

  const pkg = JSON.parse(fs.readFileSync(protocolPkgJsonPath, "utf8"))
  if (!pkg.version) {
    throw new Error("packages/protocol/package.json missing version")
  }

  if (!fs.existsSync(constantsModulePath)) {
    throw new Error(
      "Protocol constants build output missing. Run protocol TypeScript build before manifest generation.",
    )
  }

  const constantsUrl = pathToFileURL(constantsModulePath).href
  const constants = await import(constantsUrl)

  const manifest = {
    protocol_semver: String(pkg.version),
    protocol_version_date: String(constants.PROTOCOL_VERSION_DATE ?? ""),
    endpoints: constants.ENDPOINTS ?? {},
    subject_header: String(constants.SUBJECT_HEADER ?? ""),
  }

  if (!manifest.protocol_version_date) {
    throw new Error("PROTOCOL_VERSION_DATE must be defined in packages/protocol/src/constants.ts")
  }

  if (!manifest.subject_header) {
    throw new Error("SUBJECT_HEADER must be defined in packages/protocol/src/constants.ts")
  }

  fs.mkdirSync(path.dirname(manifestPath), { recursive: true })
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n", "utf8")
  console.log(`Wrote protocol manifest: ${path.relative(repoRoot, manifestPath)}`)
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err))
  process.exit(1)
})
