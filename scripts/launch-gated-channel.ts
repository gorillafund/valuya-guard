import { spawn, spawnSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import {
  generateGatedChannelConfig,
  parseEnvFile,
  parseGatedChannelArgs,
  resolveChannelPackageName,
  resolveChannelServerPath,
  resolveGatedChannelOptions,
  type GatedChannel,
  writeGatedChannelConfig,
} from "./lib/gatedChannel.js"

function main(): void {
  const values = parseGatedChannelArgs(process.argv.slice(2))
  const repoRoot = process.cwd()
  const dryRun = values.get("dry-run") === "true" || process.argv.includes("--dry-run")

  const envPath = resolveEnvPath(repoRoot, values)
  const channel = resolveChannel(envPath, values)
  const serverPath = resolveChannelServerPath(repoRoot, channel)
  const packageName = resolveChannelPackageName(channel)

  ensurePackageBuilt(repoRoot, packageName)
  const mergedEnv = {
    ...process.env,
    ...parseEnvFile(envPath),
  }

  if (dryRun) {
    console.log(JSON.stringify({
      ok: true,
      channel,
      envPath: path.relative(repoRoot, envPath),
      packageName,
      serverPath: path.relative(repoRoot, serverPath),
    }, null, 2))
    return
  }

  if (!fs.existsSync(serverPath)) {
    throw new Error(`Missing built server entry: ${serverPath}`)
  }

  const child = spawn(process.execPath, [serverPath], {
    cwd: repoRoot,
    env: mergedEnv,
    stdio: "inherit",
  })

  child.on("exit", (code) => {
    process.exit(code ?? 0)
  })
}

function resolveEnvPath(repoRoot: string, values: Map<string, string>): string {
  const explicitEnv = values.get("env")
  if (explicitEnv) return path.resolve(repoRoot, explicitEnv)

  const options = resolveGatedChannelOptions(values)
  const { outputPath, output } = generateGatedChannelConfig(repoRoot, options)
  writeGatedChannelConfig(outputPath, output)
  console.log(`Generated gated channel config: ${path.relative(repoRoot, outputPath)}`)
  return outputPath
}

function resolveChannel(envPath: string, values: Map<string, string>): GatedChannel {
  const explicit = values.get("channel")
  if (explicit === "whatsapp" || explicit === "telegram") return explicit
  const env = parseEnvFile(envPath)
  if (env.WHATSAPP_CHANNEL_APP_ID) return "whatsapp"
  if (env.TELEGRAM_CHANNEL_APP_ID) return "telegram"
  throw new Error("Could not infer channel. Pass --channel or use a valid generated env file.")
}

function ensurePackageBuilt(repoRoot: string, packageName: string): void {
  const result = spawnSync("pnpm", ["--filter", packageName, "build"], {
    cwd: repoRoot,
    stdio: "inherit",
  })
  if (result.status !== 0) {
    throw new Error(`Failed to build ${packageName}`)
  }
}

try {
  main()
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  console.error("")
  console.error("Usage:")
  console.error("  pnpm gated-channel:launch --channel whatsapp --preset mentor --slug mentor_demo")
  console.error("  pnpm gated-channel:launch --env .data/generated/whatsapp-mentor-mentor_demo.env --channel whatsapp")
  console.error("  pnpm gated-channel:launch --channel telegram --preset support --slug support_demo --dry-run")
  process.exit(1)
}
