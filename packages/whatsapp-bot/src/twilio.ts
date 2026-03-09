import { createHmac, timingSafeEqual } from "node:crypto"

export type TwilioInboundMessage = {
  from: string
  body: string
  messageSid: string
  profileName?: string
  params: URLSearchParams
}

export function parseTwilioForm(rawBody: string): TwilioInboundMessage {
  const params = new URLSearchParams(rawBody)
  return {
    from: String(params.get("From") ?? "").trim(),
    body: String(params.get("Body") ?? "").trim(),
    messageSid: String(params.get("MessageSid") ?? "").trim(),
    profileName: String(params.get("ProfileName") ?? "").trim() || undefined,
    params,
  }
}

export function isValidTwilioSignature(args: {
  authToken: string
  signatureHeader: string | null
  url: string
  params: URLSearchParams
}): boolean {
  const signature = String(args.signatureHeader || "").trim()
  if (!signature) return false

  const digest = computeTwilioSignature(args.authToken, args.url, args.params)
  return safeCompareBase64(signature, digest)
}

export function twimlMessage(text: string): string {
  const escaped = escapeXml(text)
  return `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${escaped}</Message></Response>`
}

export async function sendOutboundWhatsAppMessage(args: {
  accountSid: string
  authToken: string
  from: string
  to: string
  body: string
}): Promise<void> {
  const endpoint = `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(args.accountSid)}/Messages.json`
  const params = new URLSearchParams({
    From: args.from,
    To: args.to,
    Body: args.body,
  })

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${args.accountSid}:${args.authToken}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: params,
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(`twilio_send_failed:${response.status}:${text.slice(0, 300)}`)
  }
}

function computeTwilioSignature(authToken: string, url: string, params: URLSearchParams): string {
  const grouped = new Map<string, string[]>()
  for (const [key, value] of params) {
    const values = grouped.get(key) || []
    values.push(value)
    grouped.set(key, values)
  }

  const sortedKeys = [...grouped.keys()].sort((a, b) => a.localeCompare(b))
  let payload = url
  for (const key of sortedKeys) {
    const values = grouped.get(key) || []
    for (const value of values) {
      payload += `${key}${value}`
    }
  }

  return createHmac("sha1", authToken).update(payload, "utf8").digest("base64")
}

function safeCompareBase64(a: string, b: string): boolean {
  try {
    const left = Buffer.from(a, "base64")
    const right = Buffer.from(b, "base64")
    if (left.length !== right.length) return false
    return timingSafeEqual(left, right)
  } catch {
    return false
  }
}

function escapeXml(input: string): string {
  return String(input)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&apos;")
}
