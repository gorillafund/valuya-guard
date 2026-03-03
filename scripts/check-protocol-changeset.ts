// @ts-nocheck
import { execSync } from "node:child_process"

const baseRef = process.env.GITHUB_BASE_REF || "main"

function gitChangedFiles(ref: string): string[] {
  const raw = execSync(`git diff --name-only ${ref}...HEAD`, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  })
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
}

function hasRef(ref: string): boolean {
  try {
    execSync(`git rev-parse --verify ${ref}`, { stdio: "ignore" })
    return true
  } catch {
    return false
  }
}

function resolveBaseCompareRef(): string {
  const primary = `origin/${baseRef}`
  if (hasRef(primary)) return primary
  if (baseRef === "main" && hasRef("origin/master")) return "origin/master"
  throw new Error(
    `Unable to find base ref ${primary}. Ensure checkout fetch-depth is 0 and remote refs are available.`,
  )
}

function isProtocolSourceFile(file: string): boolean {
  return file.startsWith("packages/protocol/src/")
}

function isChangesetMarkdown(file: string): boolean {
  if (!file.startsWith(".changeset/")) return false
  if (!file.endsWith(".md")) return false
  if (file === ".changeset/README.md") return false
  return true
}

function main(): void {
  const compareRef = resolveBaseCompareRef()
  const changed = gitChangedFiles(compareRef)

  const protocolChanged = changed.some(isProtocolSourceFile)
  if (!protocolChanged) {
    console.log("No protocol source changes detected.")
    return
  }

  const hasChangeset = changed.some(isChangesetMarkdown)
  if (!hasChangeset) {
    throw new Error("Protocol changed but no changeset found. Run `pnpm changeset`.")
  }

  console.log("Protocol changeset requirement satisfied.")
}

main()
