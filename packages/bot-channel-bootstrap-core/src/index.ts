export type ChannelMode =
  | { kind: "human" }
  | { kind: "agent"; soulId: string }

export type SoulProvider = "openai" | "webhook"

export function normalizeChannelMode(args: {
  value?: string
  soulId: string
}): ChannelMode {
  return String(args.value || "human").trim().toLowerCase() === "agent"
    ? { kind: "agent", soulId: args.soulId }
    : { kind: "human" }
}

export function normalizeSoulProvider(value?: string): SoulProvider {
  const normalized = String(value || "openai").trim().toLowerCase()
  if (normalized === "webhook" || normalized === "api" || normalized === "n8n" || normalized === "langchain") {
    return "webhook"
  }
  return "openai"
}

export function createConfiguredSoul<TSoul extends { locale?: string; systemPrompt: string; responseSchema?: unknown }>(args: {
  baseSoul: TSoul
  responseSchemaJson?: string
}): TSoul {
  const raw = String(args.responseSchemaJson || "").trim()
  if (!raw) return args.baseSoul
  try {
    const parsed = JSON.parse(raw)
    if (parsed && typeof parsed === "object") {
      return {
        ...args.baseSoul,
        responseSchema: parsed,
      }
    }
  } catch {
    // keep default soul config
  }
  return args.baseSoul
}

export function createOptionalOpenAISoulRuntime<TRuntime>(args: {
  mode: ChannelMode
  apiKey?: string
  model?: string
  createRunner: (args: { apiKey: string; model: string }) => unknown
  createRuntime: (args: { runCompletion: unknown }) => TRuntime
}): TRuntime | undefined {
  if (args.mode.kind !== "agent") return undefined
  const apiKey = String(args.apiKey || "").trim()
  if (!apiKey) return undefined
  return args.createRuntime({
    runCompletion: args.createRunner({
      apiKey,
      model: String(args.model || "gpt-4.1-mini").trim() || "gpt-4.1-mini",
    }),
  })
}

export function createOptionalWebhookSoulRuntime<TRuntime>(args: {
  mode: ChannelMode
  provider?: string
  url?: string
  authToken?: string
  timeoutMs?: number
  extraHeaders?: Record<string, string>
  createRuntime: (args: {
    url: string
    provider?: string
    authToken?: string
    timeoutMs?: number
    extraHeaders?: Record<string, string>
  }) => TRuntime
}): TRuntime | undefined {
  if (args.mode.kind !== "agent") return undefined
  const url = String(args.url || "").trim()
  if (!url) return undefined
  return args.createRuntime({
    url,
    provider: normalizeSoulProvider(args.provider),
    authToken: String(args.authToken || "").trim() || undefined,
    timeoutMs: args.timeoutMs,
    extraHeaders: args.extraHeaders,
  })
}

export function parseJsonHeaders(value?: string): Record<string, string> | undefined {
  const raw = String(value || "").trim()
  if (!raw) return undefined
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>
    const headers = Object.fromEntries(
      Object.entries(parsed)
        .filter((entry): entry is [string, string | number | boolean] => (
          typeof entry[0] === "string"
          && ["string", "number", "boolean"].includes(typeof entry[1])
        ))
        .map(([key, headerValue]) => [key, String(headerValue)]),
    )
    return Object.keys(headers).length ? headers : undefined
  } catch {
    return undefined
  }
}
