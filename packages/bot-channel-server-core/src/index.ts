import fs from "node:fs"
import path from "node:path"

export function loadEnvFile(filePath = process.env.ENV_FILE?.trim() || path.resolve(process.cwd(), ".env")): void {
  if (!filePath) return
  if (!fs.existsSync(filePath)) return

  const raw = fs.readFileSync(filePath, "utf8")
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith("#")) continue
    const eqIndex = trimmed.indexOf("=")
    if (eqIndex <= 0) continue

    const key = trimmed.slice(0, eqIndex).trim()
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue
    if (process.env[key]?.trim()) continue

    let value = trimmed.slice(eqIndex + 1).trim()
    if (
      (value.startsWith("\"") && value.endsWith("\"")) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    process.env[key] = value
  }
}

export function requiredEnv(name: string): string {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`${name}_required`)
  return value
}

export function getRequestPath(rawUrl?: string | null): string {
  if (!rawUrl) return "/"
  try {
    return new URL(rawUrl, "http://localhost").pathname
  } catch {
    return "/"
  }
}

export async function readRequestBody(req: AsyncIterable<unknown>): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)))
  }
  return Buffer.concat(chunks).toString("utf8")
}

export async function parseJsonBody(req: AsyncIterable<unknown>): Promise<Record<string, unknown>> {
  const raw = await readRequestBody(req)
  if (!raw.trim()) return {}
  const parsed = JSON.parse(raw)
  return parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : {}
}

export function resolveRequestUrl(args: {
  headers: Record<string, string | string[] | undefined>
  url?: string | null
}): string {
  const forwardedProto = normalizeHeaderValue(args.headers["x-forwarded-proto"])
  const forwardedHost = normalizeHeaderValue(args.headers["x-forwarded-host"])
  const host = normalizeHeaderValue(args.headers.host)
  const proto = forwardedProto || "http"
  const resolvedHost = forwardedHost || host || "localhost"
  return `${proto}://${resolvedHost}${args.url || "/"}`
}

export async function handleInternalJsonMessage(args: {
  req: AsyncIterable<unknown>
  internalApiToken?: string
  providedToken?: string | null
  onMessage: (body: Record<string, unknown>) => Promise<{
    reply: string
    metadata?: Record<string, unknown>
  }>
}): Promise<{
  status: number
  headers: Record<string, string>
  body: string
}> {
  if (args.internalApiToken) {
    const provided = String(args.providedToken || "").trim()
    if (provided !== args.internalApiToken) {
      return {
        status: 401,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ok: false, error: "unauthorized" }),
      }
    }
  }

  const body = await parseJsonBody(args.req)
  const result = await args.onMessage(body)
  return {
    status: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ok: true, reply: result.reply, metadata: result.metadata || {} }),
  }
}

export function createOpenAIResponsesRunner(args: { apiKey: string; model: string }) {
  return async (input: {
    system: string
    user: string
  }): Promise<Record<string, unknown> | string> => {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${args.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: args.model,
        input: [
          { role: "system", content: input.system },
          { role: "user", content: input.user },
        ],
      }),
    })
    const body = await safeParseJson(response)
    if (!response.ok) {
      throw new Error(`bot_channel_openai_failed:${response.status}:${JSON.stringify(body).slice(0, 300)}`)
    }
    return extractResponseObject(body)
  }
}

export function tryParseJson(value: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(value)
    return parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : null
  } catch {
    return null
  }
}

export async function safeParseJson(response: Response): Promise<unknown> {
  const text = await response.text()
  if (!text.trim()) return {}
  try {
    return JSON.parse(text)
  } catch {
    return { raw: text }
  }
}

export function extractResponseObject(body: unknown): Record<string, unknown> | string {
  const record = body && typeof body === "object" ? body as Record<string, unknown> : {}
  if (typeof record.output_text === "string" && record.output_text.trim()) {
    const parsed = tryParseJson(record.output_text)
    return parsed || record.output_text.trim()
  }
  const output = Array.isArray(record.output) ? record.output : []
  const chunks: string[] = []
  for (const item of output) {
    const content = Array.isArray((item as Record<string, unknown>)?.content)
      ? (item as Record<string, unknown>).content as Array<Record<string, unknown>>
      : []
    for (const part of content) {
      if (typeof part.text === "string" && part.text.trim()) chunks.push(part.text.trim())
    }
  }
  const text = chunks.join("\n").trim()
  return tryParseJson(text) || text
}

function normalizeHeaderValue(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return String(value[0] || "").split(",")[0]?.trim() || ""
  return String(value || "").split(",")[0]?.trim() || ""
}
