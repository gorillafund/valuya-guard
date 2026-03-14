export function buildWhatsAppChannelResource(args: {
  resource?: string
  provider?: string
  channelIdentifier?: string
  phoneNumber?: string
}): string {
  const explicit = cleanOptional(args.resource)
  if (explicit) return explicit

  const provider = cleanOptional(args.provider)
  const channelIdentifier = cleanOptional(args.channelIdentifier)
  const phone = cleanOptional(args.phoneNumber)
  if (!provider || !channelIdentifier || !phone) {
    throw new Error("whatsapp_channel_resource_config_missing")
  }
  return `whatsapp:channel:${provider}:${channelIdentifier}:${normalizePhone(phone)}`
}

function normalizePhone(input: string): string {
  return String(input || "").trim().replace(/^\+/, "").replace(/\s+/g, "")
}

function cleanOptional(value: unknown): string | undefined {
  const v = String(value || "").trim()
  return v || undefined
}
