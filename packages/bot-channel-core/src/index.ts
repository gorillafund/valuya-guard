import { mkdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"

export type SoulResponseSchema = {
  format: "json"
  replyKey: string
  followUpQuestionKey?: string
  followUpQuestionsKey?: string
  nextStepKey?: string
  summaryKey?: string
  userProfileKey?: string
  rootPatternKey?: string
}

export type ChannelSoulDefinition = {
  id: string
  name: string
  systemPrompt: string
  locale?: string
  memoryPolicy?: {
    keepRecentTurns: number
    summarizeAfterTurns: number
  }
  tools?: string[]
  responseSchema?: SoulResponseSchema
}

export type SoulMemoryTurn = {
  role: "user" | "assistant"
  content: string
  createdAt: string
}

export type SoulMemory = {
  recentTurns: SoulMemoryTurn[]
  summaries: string[]
  userProfile?: Record<string, unknown>
  updatedAt: string
}

export type SoulResponse = {
  reply: string
  memory?: SoulMemory
  metadata?: Record<string, unknown>
}

export type WebhookSoulRuntimeRequest = {
  version: "1"
  provider: string
  soul: {
    id: string
    name: string
    locale?: string
    systemPrompt: string
    tools?: string[]
    memoryPolicy?: {
      keepRecentTurns: number
      summarizeAfterTurns: number
    }
    responseSchema?: SoulResponseSchema
  }
  message: string
  memory: SoulMemory
  protocolSubjectHeader: string
  locale?: string
  context: {
    protocolSubjectHeader: string
    locale?: string
  }
}

export type WebhookSoulRuntimeResponse =
  | string
  | SoulResponse
  | {
      reply?: string
      memory?: SoulMemory
      metadata?: Record<string, unknown>
      [key: string]: unknown
    }
  | Record<string, unknown>

export type StructuredCompletionResult =
  | string
  | SoulResponse
  | Record<string, unknown>

export type StructuredCompletionRunner = (args: {
  system: string
  user: string
  locale?: string
  soul: ChannelSoulDefinition
  schema?: SoulResponseSchema
}) => Promise<StructuredCompletionResult>

export type SoulRuntimeLike = {
  run(args: {
    soul: ChannelSoulDefinition
    message: string
    memory: SoulMemory
    protocolSubjectHeader: string
    locale?: string
  }): Promise<SoulResponse>
}

export class SchemaDrivenSoulRuntime implements SoulRuntimeLike {
  constructor(private readonly deps: {
    runCompletion: StructuredCompletionRunner
  }) {}

  async run(args: {
    soul: ChannelSoulDefinition
    message: string
    memory: SoulMemory
    protocolSubjectHeader: string
    locale?: string
  }): Promise<SoulResponse> {
    const schema = args.soul.responseSchema
    const result = await this.deps.runCompletion({
      system: buildSystemPrompt(args.soul, schema, args.locale),
      user: buildUserPrompt(args.message, args.memory, args.protocolSubjectHeader),
      locale: args.locale || args.soul.locale,
      soul: args.soul,
      schema,
    })

    const normalized = normalizeCompletionResult(result, schema)
    return {
      reply: normalized.reply,
      memory: mergeMemory({
        memory: args.memory,
        userMessage: args.message,
        assistantReply: normalized.reply,
        schema,
        payload: normalized.payload,
      }),
      metadata: normalized.payload || undefined,
    }
  }
}

export class WebhookSoulRuntime implements SoulRuntimeLike {
  constructor(private readonly deps: {
    url: string
    provider?: string
    authToken?: string
    timeoutMs?: number
    extraHeaders?: Record<string, string>
  }) {}

  async run(args: {
    soul: ChannelSoulDefinition
    message: string
    memory: SoulMemory
    protocolSubjectHeader: string
    locale?: string
  }): Promise<SoulResponse> {
    const payload: WebhookSoulRuntimeRequest = {
      version: "1",
      provider: String(this.deps.provider || "webhook").trim() || "webhook",
      soul: {
        id: args.soul.id,
        name: args.soul.name,
        locale: args.soul.locale,
        systemPrompt: args.soul.systemPrompt,
        tools: args.soul.tools,
        memoryPolicy: args.soul.memoryPolicy,
        responseSchema: args.soul.responseSchema,
      },
      message: args.message,
      memory: args.memory,
      protocolSubjectHeader: args.protocolSubjectHeader,
      locale: args.locale || args.soul.locale,
      context: {
        protocolSubjectHeader: args.protocolSubjectHeader,
        locale: args.locale || args.soul.locale,
      },
    }

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), Math.max(1000, this.deps.timeoutMs || 30000))
    try {
      const response = await fetch(this.deps.url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          ...(this.deps.authToken ? { Authorization: `Bearer ${this.deps.authToken}` } : {}),
          ...(this.deps.extraHeaders || {}),
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      })
      const body = await safeParseJson(response)
      if (!response.ok) {
        throw new Error(`bot_channel_webhook_runtime_failed:${response.status}:${JSON.stringify(body).slice(0, 300)}`)
      }

      const normalized = normalizeCompletionResult(body as StructuredCompletionResult, args.soul.responseSchema)
      const record = body && typeof body === "object" ? body as Record<string, unknown> : undefined
      return {
        reply: normalized.reply,
        memory: isSoulMemory(record?.memory)
          ? record?.memory as SoulMemory
          : mergeMemory({
            memory: args.memory,
            userMessage: args.message,
            assistantReply: normalized.reply,
            schema: args.soul.responseSchema,
            payload: normalized.payload,
          }),
        metadata: normalized.payload || (record && typeof record === "object" ? record : undefined),
      }
    } finally {
      clearTimeout(timeout)
    }
  }
}

export class FileSoulMemoryStore {
  constructor(private readonly filePath: string) {}

  async load(args: {
    userId?: string
    whatsappUserId?: string
    telegramUserId?: string
    soulId: string
  }): Promise<SoulMemory> {
    const state = await this.readState()
    return state[this.key(args)] || emptyMemory()
  }

  async save(args: {
    userId?: string
    whatsappUserId?: string
    telegramUserId?: string
    soulId: string
    memory: SoulMemory
  }): Promise<void> {
    const state = await this.readState()
    state[this.key(args)] = args.memory
    await mkdir(path.dirname(this.filePath), { recursive: true })
    await writeFile(this.filePath, JSON.stringify(state, null, 2), "utf8")
  }

  private key(args: {
    userId?: string
    whatsappUserId?: string
    telegramUserId?: string
    soulId: string
  }): string {
    const userId = readString(args.userId)
      || readString(args.whatsappUserId)
      || readString(args.telegramUserId)
      || "unknown"
    return `${userId}::${String(args.soulId).trim()}`
  }

  private async readState(): Promise<Record<string, SoulMemory>> {
    try {
      const raw = await readFile(this.filePath, "utf8")
      const parsed = JSON.parse(raw) as Record<string, SoulMemory>
      return parsed && typeof parsed === "object" ? parsed : {}
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code === "ENOENT") return {}
      throw error
    }
  }
}

export function createMentorSoulDefinition(args?: {
  id?: string
  name?: string
  locale?: string
  systemPrompt?: string
}): ChannelSoulDefinition {
  return {
    id: args?.id || "mentor",
    name: args?.name || "Mentor",
    locale: args?.locale || "de",
    systemPrompt: args?.systemPrompt || [
      "Du bist ein ganzheitlicher Mentor fuer persoenliches Wachstum.",
      "Du antwortest ruhig, klar, praezise und menschlich.",
      "Du hilfst dem Nutzer, Muster zu erkennen, die eigentliche Frage zu schaerfen und einen hilfreichen naechsten Schritt zu sehen.",
      "Du stellst lieber eine gute weiterfuehrende Frage als vorschnell allgemeine Ratschlaege zu geben.",
      "Du vermeidest Floskeln, Pathos und leere Motivation.",
      "Deine Antworten sollen sich natuerlich wie ein hilfreicher, aufmerksamer Mentor anfuehlen.",
    ].join(" "),
    responseSchema: {
      format: "json",
      replyKey: "mentor_reply",
      followUpQuestionKey: "deep_question",
      followUpQuestionsKey: "follow_up_questions",
      nextStepKey: "next_step",
      summaryKey: "conversation_summary",
      userProfileKey: "user_profile",
      rootPatternKey: "root_pattern",
    },
  }
}

export function createSupportSoulDefinition(args?: {
  id?: string
  name?: string
  locale?: string
  systemPrompt?: string
}): ChannelSoulDefinition {
  return {
    id: args?.id || "support",
    name: args?.name || "Support",
    locale: args?.locale || "de",
    systemPrompt: args?.systemPrompt || [
      "Du bist ein ruhiger, klarer Premium-Support-Assistent.",
      "Du hilfst dem Nutzer, sein Problem strukturiert zu beschreiben, das eigentliche Hindernis zu erkennen und den naechsten sinnvollen Schritt zu sehen.",
      "Du antwortest freundlich, konkret und ohne Support-Floskeln.",
      "Wenn etwas unklar ist, stellst du genau eine gute Rueckfrage statt viele auf einmal.",
      "Du formulierst so, dass sich die Hilfe natuerlich und menschlich anfuehlt.",
    ].join(" "),
    responseSchema: {
      format: "json",
      replyKey: "support_reply",
      followUpQuestionKey: "clarifying_question",
      nextStepKey: "next_step",
      summaryKey: "case_summary",
      userProfileKey: "customer_context",
      rootPatternKey: "issue_pattern",
    },
  }
}

export function createConciergeSoulDefinition(args?: {
  id?: string
  name?: string
  locale?: string
  systemPrompt?: string
}): ChannelSoulDefinition {
  return {
    id: args?.id || "concierge",
    name: args?.name || "Concierge",
    locale: args?.locale || "de",
    systemPrompt: args?.systemPrompt || [
      "Du bist ein persoenlicher Premium-Concierge.",
      "Du antwortest aufmerksam, diskret, loesungsorientiert und natuerlich.",
      "Du hilfst dem Nutzer, seinen Wunsch klarer zu machen, passende Optionen zu erkennen und mit wenig Aufwand weiterzukommen.",
      "Du stellst gezielte Rueckfragen, wenn sie wirklich helfen, und gibst am Ende eine klare Empfehlung oder einen naechsten Schritt.",
    ].join(" "),
    responseSchema: {
      format: "json",
      replyKey: "concierge_reply",
      followUpQuestionKey: "clarifying_question",
      followUpQuestionsKey: "option_questions",
      nextStepKey: "recommended_next_step",
      summaryKey: "preference_summary",
      userProfileKey: "user_preferences",
      rootPatternKey: "decision_style",
    },
  }
}

function emptyMemory(): SoulMemory {
  return {
    recentTurns: [],
    summaries: [],
    userProfile: {},
    updatedAt: new Date(0).toISOString(),
  }
}

function buildSystemPrompt(
  soul: ChannelSoulDefinition,
  schema: SoulResponseSchema | undefined,
  locale?: string,
): string {
  if (!schema) return soul.systemPrompt
  return [
    soul.systemPrompt,
    "",
    `Antworte in ${locale || soul.locale || "de"}.`,
    "Liefere eine natuerliche, hilfreiche Antwort.",
    "Gib strikt JSON zurueck.",
    `Pflichtfeld fuer die Hauptantwort: ${schema.replyKey}.`,
    schema.followUpQuestionKey ? `Optionales naechstes Fragefeld: ${schema.followUpQuestionKey}.` : null,
    schema.followUpQuestionsKey ? `Optionales Feld fuer weitere Fragen: ${schema.followUpQuestionsKey}.` : null,
    schema.nextStepKey ? `Optionales Feld fuer den naechsten Schritt: ${schema.nextStepKey}.` : null,
    schema.summaryKey ? `Optionales Feld fuer eine kurze Memory-Zusammenfassung: ${schema.summaryKey}.` : null,
    schema.userProfileKey ? `Optionales Feld fuer strukturierte Nutzerhinweise: ${schema.userProfileKey}.` : null,
    schema.rootPatternKey ? `Optionales Feld fuer ein erkanntes Grundmuster: ${schema.rootPatternKey}.` : null,
  ].filter(Boolean).join("\n")
}

function buildUserPrompt(message: string, memory: SoulMemory, protocolSubjectHeader: string): string {
  const summary = memory.summaries.join("\n") || "(keine Zusammenfassung)"
  const turns = memory.recentTurns.map((turn) => `${turn.role}: ${turn.content}`).join("\n") || "(kein Verlauf)"
  return [
    `Protocol subject: ${protocolSubjectHeader}`,
    `Memory summary:\n${summary}`,
    `Recent turns:\n${turns}`,
    `Current message:\n${message}`,
  ].join("\n\n")
}

function normalizeCompletionResult(
  result: StructuredCompletionResult,
  schema: SoulResponseSchema | undefined,
): { reply: string; payload?: Record<string, unknown> } {
  if (typeof result === "string") {
    if (!schema) return { reply: result.trim() }
    const parsed = tryParseJson(result)
    if (parsed) return composeStructuredReply(parsed, schema)
    return { reply: result.trim() }
  }

  if (isSoulResponse(result)) {
    return {
      reply: String(result.reply || "").trim(),
      payload: result.metadata && typeof result.metadata === "object"
        ? result.metadata as Record<string, unknown>
        : undefined,
    }
  }

  if (result && typeof result === "object") {
    return schema
      ? composeStructuredReply(result as Record<string, unknown>, schema)
      : { reply: String((result as Record<string, unknown>).reply || "").trim(), payload: result as Record<string, unknown> }
  }

  return { reply: "" }
}

function composeStructuredReply(
  payload: Record<string, unknown>,
  schema: SoulResponseSchema,
): { reply: string; payload: Record<string, unknown> } {
  const parts: string[] = []
  const main = readString(payload[schema.replyKey])
  if (main) parts.push(main)

  const followUpQuestion = schema.followUpQuestionKey ? readString(payload[schema.followUpQuestionKey]) : undefined
  if (followUpQuestion) parts.push(followUpQuestion)

  const followUpQuestions = schema.followUpQuestionsKey ? readStringList(payload[schema.followUpQuestionsKey]) : []
  if (followUpQuestions.length) parts.push(followUpQuestions.join("\n"))

  const nextStep = schema.nextStepKey ? readString(payload[schema.nextStepKey]) : undefined
  if (nextStep) parts.push(nextStep)

  return {
    reply: parts.filter(Boolean).join("\n\n").trim(),
    payload,
  }
}

function mergeMemory(args: {
  memory: SoulMemory
  userMessage: string
  assistantReply: string
  schema?: SoulResponseSchema
  payload?: Record<string, unknown>
}): SoulMemory {
  const base = appendMemory(args.memory, args.userMessage, args.assistantReply)
  const payload = args.payload
  const schema = args.schema
  if (!payload || !schema) return base

  const summaries = [...base.summaries]
  const summary = schema.summaryKey ? readString(payload[schema.summaryKey]) : undefined
  if (summary && !summaries.includes(summary)) summaries.push(summary)

  const userProfile = {
    ...(base.userProfile || {}),
    ...(schema.userProfileKey && payload[schema.userProfileKey] && typeof payload[schema.userProfileKey] === "object"
      ? payload[schema.userProfileKey] as Record<string, unknown>
      : {}),
  }

  const rootPattern = schema.rootPatternKey ? readString(payload[schema.rootPatternKey]) : undefined
  if (rootPattern) {
    const existing = Array.isArray(userProfile.recurringPatterns)
      ? userProfile.recurringPatterns as string[]
      : []
    if (!existing.includes(rootPattern)) {
      userProfile.recurringPatterns = [...existing, rootPattern]
    }
  }

  return {
    ...base,
    summaries: summaries.slice(-8),
    userProfile,
  }
}

function appendMemory(memory: SoulMemory, userMessage: string, assistantReply: string): SoulMemory {
  const nextTurns = [
    ...memory.recentTurns,
    { role: "user" as const, content: userMessage, createdAt: new Date().toISOString() },
    { role: "assistant" as const, content: assistantReply, createdAt: new Date().toISOString() },
  ].slice(-12)

  return {
    ...memory,
    recentTurns: nextTurns,
    updatedAt: new Date().toISOString(),
  }
}

function isSoulResponse(value: unknown): value is SoulResponse {
  return Boolean(value) && typeof value === "object" && typeof (value as Record<string, unknown>).reply === "string"
}

function isSoulMemory(value: unknown): value is SoulMemory {
  return Boolean(value)
    && typeof value === "object"
    && Array.isArray((value as Record<string, unknown>).recentTurns)
    && Array.isArray((value as Record<string, unknown>).summaries)
    && typeof (value as Record<string, unknown>).updatedAt === "string"
}

async function safeParseJson(response: Response): Promise<unknown> {
  const text = await response.text()
  if (!text.trim()) return {}
  try {
    return JSON.parse(text)
  } catch {
    return { reply: text.trim() }
  }
}

function tryParseJson(value: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(value)
    return parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : null
  } catch {
    return null
  }
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined
}

function readStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.map((entry) => readString(entry)).filter((entry): entry is string => Boolean(entry))
}
