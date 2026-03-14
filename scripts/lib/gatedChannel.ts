import fs from "node:fs"
import path from "node:path"

export type GatedChannel = "whatsapp" | "telegram"
export type GatedPreset = "mentor" | "support" | "concierge"

export type GatedChannelOptions = {
  channel: GatedChannel
  preset: GatedPreset
  slug: string
  output: string
  name?: string
  appId?: string
  phoneNumber?: string
  botName?: string
  inviteUrl?: string
}

export function parseGatedChannelArgs(argv: string[]): Map<string, string> {
  const values = new Map<string, string>()
  for (let index = 0; index < argv.length; index += 1) {
    const part = argv[index]
    if (!part.startsWith("--")) continue
    const key = part.slice(2)
    const value = argv[index + 1]
    if (!value || value.startsWith("--")) {
      values.set(key, "true")
      continue
    }
    values.set(key, value)
    index += 1
  }
  return values
}

export function resolveGatedChannelOptions(values: Map<string, string>): GatedChannelOptions {
  const channel = readChannel(values.get("channel"))
  const preset = readPreset(values.get("preset"))
  const slug = readRequired(values.get("slug"), "--slug")
  const output = values.get("output") || `.data/generated/${channel}-${preset}-${slug}.env`

  return {
    channel,
    preset,
    slug,
    output,
    name: values.get("name") || defaultName(preset, slug),
    appId: values.get("app-id") || defaultAppId(channel, slug),
    phoneNumber: values.get("phone-number") || "49123456789",
    botName: values.get("bot-name") || `${slug}_bot`,
    inviteUrl: values.get("invite-url") || `https://t.me/${slug}_bot`,
  }
}

export function generateGatedChannelConfig(repoRoot: string, options: GatedChannelOptions): {
  outputPath: string
  output: string
} {
  const templatePath = resolveTemplatePath(repoRoot, options.channel, options.preset)
  const template = fs.readFileSync(templatePath, "utf8")
  const output = applyReplacements(template, options)
  const outputPath = path.resolve(repoRoot, options.output)
  return { outputPath, output }
}

export function writeGatedChannelConfig(outputPath: string, output: string): void {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true })
  fs.writeFileSync(outputPath, output, "utf8")
}

export function parseEnvFile(filePath: string): Record<string, string> {
  const env: Record<string, string> = {}
  const raw = fs.readFileSync(filePath, "utf8")
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith("#")) continue
    const eqIndex = trimmed.indexOf("=")
    if (eqIndex <= 0) continue
    const key = trimmed.slice(0, eqIndex).trim()
    const value = trimmed.slice(eqIndex + 1)
    env[key] = value
  }
  return env
}

export function resolveChannelServerPath(repoRoot: string, channel: GatedChannel): string {
  return path.join(repoRoot, "packages", `${channel}-bot-channel`, "dist", "server.js")
}

export function resolveChannelPackageName(channel: GatedChannel): string {
  return channel === "whatsapp"
    ? "@valuya/whatsapp-bot-channel"
    : "@valuya/telegram-bot-channel"
}

export function inferChannelFromEnv(env: Record<string, string>): GatedChannel | null {
  if (env.WHATSAPP_CHANNEL_APP_ID) return "whatsapp"
  if (env.TELEGRAM_CHANNEL_APP_ID) return "telegram"
  return null
}

function resolveTemplatePath(repoRoot: string, channel: GatedChannel, preset: GatedPreset): string {
  return path.join(repoRoot, "packages", `${channel}-bot-channel`, `.env.${preset}.example`)
}

function applyReplacements(template: string, options: GatedChannelOptions): string {
  const replacements = options.channel === "whatsapp"
    ? buildWhatsAppReplacements(options)
    : buildTelegramReplacements(options)

  let next = template
  for (const [from, to] of replacements) {
    next = next.split(from).join(to)
  }
  return next
}

function buildWhatsAppReplacements(options: GatedChannelOptions): Array<[string, string]> {
  const phone = options.phoneNumber || "49123456789"
  const identifier = options.slug
  return [
    ["whatsapp_main", options.appId || defaultAppId("whatsapp", options.slug)],
    ["mentor_demo", identifier],
    ["support_demo", identifier],
    ["concierge_demo", identifier],
    ["49123456789", phone],
    ["https://wa.me/49123456789", `https://wa.me/${phone}`],
    ["Mentor Demo", options.name || defaultName(options.preset, options.slug)],
    ["Premium Support", options.name || defaultName(options.preset, options.slug)],
    ["Premium Concierge", options.name || defaultName(options.preset, options.slug)],
  ]
}

function buildTelegramReplacements(options: GatedChannelOptions): Array<[string, string]> {
  const botName = options.botName || `${options.slug}_bot`
  const inviteUrl = options.inviteUrl || `https://t.me/${botName}`
  return [
    ["telegram_main", options.appId || defaultAppId("telegram", options.slug)],
    ["mentor_demo", options.slug],
    ["support_demo", options.slug],
    ["concierge_demo", options.slug],
    ["mentor_demo_bot", botName],
    ["support_demo_bot", botName],
    ["concierge_demo_bot", botName],
    ["https://t.me/mentor_demo_bot", inviteUrl],
    ["https://t.me/support_demo_bot", inviteUrl],
    ["https://t.me/concierge_demo_bot", inviteUrl],
    ["Mentor Demo", options.name || defaultName(options.preset, options.slug)],
    ["Premium Support", options.name || defaultName(options.preset, options.slug)],
    ["Premium Concierge", options.name || defaultName(options.preset, options.slug)],
  ]
}

function readChannel(value: string | undefined): GatedChannel {
  if (value === "whatsapp" || value === "telegram") return value
  throw new Error("Expected --channel whatsapp|telegram")
}

function readPreset(value: string | undefined): GatedPreset {
  if (value === "mentor" || value === "support" || value === "concierge") return value
  throw new Error("Expected --preset mentor|support|concierge")
}

function readRequired(value: string | undefined, flag: string): string {
  if (!value?.trim()) throw new Error(`Missing required ${flag}`)
  return value.trim()
}

function defaultName(preset: GatedPreset, slug: string): string {
  const base = slug.replace(/[-_]+/g, " ").trim()
  const title = base
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ")
  const fallback = preset.charAt(0).toUpperCase() + preset.slice(1)
  return title || fallback
}

function defaultAppId(channel: GatedChannel, slug: string): string {
  return `${channel}_${slug}`
}
