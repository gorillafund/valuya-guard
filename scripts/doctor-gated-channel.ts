import fs from "node:fs"
import path from "node:path"
import {
  generateGatedChannelConfig,
  inferChannelFromEnv,
  parseEnvFile,
  parseGatedChannelArgs,
  resolveGatedChannelOptions,
} from "./lib/gatedChannel.js"

type Severity = "error" | "warning"

type Finding = {
  severity: Severity
  message: string
}

function main(): void {
  const values = parseGatedChannelArgs(process.argv.slice(2))
  const repoRoot = process.cwd()
  const envInfo = resolveEnv(repoRoot, values)
  const env = parseEnvFile(envInfo.envPath)
  const channel = resolveChannel(values, env)
  const findings = validateChannel({ channel, env, repoRoot })

  const errors = findings.filter((finding) => finding.severity === "error")
  const warnings = findings.filter((finding) => finding.severity === "warning")

  console.log(JSON.stringify({
    ok: errors.length === 0,
    channel,
    envPath: path.relative(repoRoot, envInfo.envPath),
    generated: envInfo.generated,
    mode: readMode(channel, env),
    provider: readProvider(channel, env),
    errors: errors.map((finding) => finding.message),
    warnings: warnings.map((finding) => finding.message),
  }, null, 2))

  if (errors.length > 0) process.exit(1)
}

function resolveEnv(repoRoot: string, values: Map<string, string>): {
  envPath: string
  generated: boolean
} {
  const explicitEnv = values.get("env")
  if (explicitEnv) {
    return {
      envPath: path.resolve(repoRoot, explicitEnv),
      generated: false,
    }
  }

  const options = resolveGatedChannelOptions(values)
  const { outputPath, output } = generateGatedChannelConfig(repoRoot, options)
  fs.mkdirSync(path.dirname(outputPath), { recursive: true })
  fs.writeFileSync(outputPath, output, "utf8")
  return {
    envPath: outputPath,
    generated: true,
  }
}

function resolveChannel(values: Map<string, string>, env: Record<string, string>): "whatsapp" | "telegram" {
  const explicit = values.get("channel")
  if (explicit === "whatsapp" || explicit === "telegram") return explicit
  const inferred = inferChannelFromEnv(env)
  if (inferred) return inferred
  throw new Error("Could not infer channel. Pass --channel or use a valid env file.")
}

function validateChannel(args: {
  channel: "whatsapp" | "telegram"
  env: Record<string, string>
  repoRoot: string
}): Finding[] {
  const findings: Finding[] = []
  const { channel, env, repoRoot } = args

  const requiredBase = channel === "whatsapp"
    ? ["VALUYA_BASE", "VALUYA_TENANT_TOKEN", "WHATSAPP_CHANNEL_APP_ID"]
    : ["VALUYA_BASE", "VALUYA_TENANT_TOKEN", "TELEGRAM_CHANNEL_APP_ID"]

  for (const key of requiredBase) {
    if (!readValue(env, key)) findings.push({ severity: "error", message: `${key} missing` })
  }

  if (channel === "whatsapp") {
    const stateFile = readValue(env, "WHATSAPP_STATE_FILE") || ".data/whatsapp-state.sqlite"
    checkWritablePath(findings, repoRoot, stateFile, "warning")
  } else {
    const linksFile = readValue(env, "TELEGRAM_LINKS_FILE")
    if (!linksFile) {
      findings.push({ severity: "error", message: "TELEGRAM_LINKS_FILE missing" })
    } else {
      checkWritablePath(findings, repoRoot, linksFile, "warning")
    }
  }

  const mode = readMode(channel, env)
  if (mode === "human") return findings

  const soulIdKey = channel === "whatsapp" ? "WHATSAPP_CHANNEL_SOUL_ID" : "TELEGRAM_CHANNEL_SOUL_ID"
  const soulPromptKey = channel === "whatsapp" ? "WHATSAPP_CHANNEL_SOUL_SYSTEM_PROMPT" : "TELEGRAM_CHANNEL_SOUL_SYSTEM_PROMPT"
  const memoryFileKey = channel === "whatsapp" ? "WHATSAPP_CHANNEL_MEMORY_FILE" : "TELEGRAM_CHANNEL_MEMORY_FILE"

  if (!readValue(env, soulIdKey)) findings.push({ severity: "error", message: `${soulIdKey} missing` })
  if (!readValue(env, soulPromptKey)) findings.push({ severity: "warning", message: `${soulPromptKey} missing` })

  const memoryFile = readValue(env, memoryFileKey)
  if (!memoryFile) {
    findings.push({ severity: "warning", message: `${memoryFileKey} missing` })
  } else {
    checkWritablePath(findings, repoRoot, memoryFile, "warning")
  }

  const provider = readProvider(channel, env)
  if (provider === "openai") {
    if (!readValue(env, "OPENAI_API_KEY")) findings.push({ severity: "error", message: "OPENAI_API_KEY missing for openai provider" })
    if (!readValue(env, "OPENAI_MODEL")) findings.push({ severity: "warning", message: "OPENAI_MODEL missing, package default will be used" })
  } else {
    const webhookUrlKey = channel === "whatsapp" ? "WHATSAPP_CHANNEL_SOUL_WEBHOOK_URL" : "TELEGRAM_CHANNEL_SOUL_WEBHOOK_URL"
    const webhookTimeoutKey = channel === "whatsapp" ? "WHATSAPP_CHANNEL_SOUL_WEBHOOK_TIMEOUT_MS" : "TELEGRAM_CHANNEL_SOUL_WEBHOOK_TIMEOUT_MS"
    const webhookHeadersKey = channel === "whatsapp" ? "WHATSAPP_CHANNEL_SOUL_WEBHOOK_HEADERS_JSON" : "TELEGRAM_CHANNEL_SOUL_WEBHOOK_HEADERS_JSON"

    if (!readValue(env, webhookUrlKey)) findings.push({ severity: "error", message: `${webhookUrlKey} missing for external runtime provider` })
    const timeout = readValue(env, webhookTimeoutKey)
    if (timeout && Number.isNaN(Number(timeout))) {
      findings.push({ severity: "error", message: `${webhookTimeoutKey} must be numeric` })
    }
    const headers = readValue(env, webhookHeadersKey)
    if (headers) {
      try {
        const parsed = JSON.parse(headers)
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
          findings.push({ severity: "error", message: `${webhookHeadersKey} must be a JSON object` })
        }
      } catch {
        findings.push({ severity: "error", message: `${webhookHeadersKey} must be valid JSON` })
      }
    }
  }

  if (channel === "whatsapp") {
    const twilioValidate = readValue(env, "TWILIO_VALIDATE_SIGNATURE")
    if (String(twilioValidate || "").toLowerCase() === "true" && !readValue(env, "TWILIO_AUTH_TOKEN")) {
      findings.push({ severity: "error", message: "TWILIO_AUTH_TOKEN missing while TWILIO_VALIDATE_SIGNATURE=true" })
    }
  }

  return findings
}

function readMode(channel: "whatsapp" | "telegram", env: Record<string, string>): "human" | "agent" {
  const key = channel === "whatsapp" ? "WHATSAPP_CHANNEL_MODE" : "TELEGRAM_CHANNEL_MODE"
  return String(readValue(env, key) || "human").trim().toLowerCase() === "agent" ? "agent" : "human"
}

function readProvider(channel: "whatsapp" | "telegram", env: Record<string, string>): string {
  const key = channel === "whatsapp" ? "WHATSAPP_CHANNEL_SOUL_PROVIDER" : "TELEGRAM_CHANNEL_SOUL_PROVIDER"
  return String(readValue(env, key) || "openai").trim().toLowerCase() || "openai"
}

function readValue(env: Record<string, string>, key: string): string | undefined {
  const value = env[key]
  return typeof value === "string" && value.trim() ? value.trim() : undefined
}

function checkWritablePath(findings: Finding[], repoRoot: string, filePath: string, severity: Severity): void {
  const absolute = path.resolve(repoRoot, filePath)
  const directory = path.dirname(absolute)
  if (!fs.existsSync(directory)) {
    findings.push({ severity, message: `Parent directory does not exist yet: ${path.relative(repoRoot, directory)}` })
  }
}

try {
  main()
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  console.error("")
  console.error("Usage:")
  console.error("  pnpm gated-channel:doctor --env packages/whatsapp-bot-channel/.env --channel whatsapp")
  console.error("  pnpm gated-channel:doctor --channel telegram --preset mentor --slug mentor_demo")
  process.exit(1)
}
