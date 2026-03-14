export type LogFn = (event: string, fields: Record<string, unknown>) => void

export type ChannelAccessState =
  | "paid_active"
  | "trial_active"
  | "expired_payment_required"
  | "inactive"

export type ChannelMode =
  | { kind: "human" }
  | { kind: "agent"; soulId: string }

export type SoulConfig = {
  id: number | string
  slug: string
  name: string
  version: number | string
  capabilities?: Record<string, unknown> | null
  tool_policy?: Record<string, unknown> | null
  memory_policy?: Record<string, unknown> | null
  compiled_prompt_artifacts?: Record<string, unknown> | null
}

export type ChannelRuntimeConfig = {
  mode: "human" | "agent"
  channel: string
  channel_kind: string
  provider: string | null
  channel_app_id?: string | null
  visit_url: string | null
  human_routing?: Record<string, unknown> | null
  agent_routing?: Record<string, unknown> | null
  fallback?: {
    allowed: boolean
    mode: "human"
  } | null
  soul: SoulConfig | null
}

export type ChannelAccessResolveRequest = {
  resource: string
  plan: string
  channel?: {
    kind?: string | null
    provider?: string | null
    channel_identifier?: string | null
    phone_number?: string | null
    bot_name?: string | null
    chat_id?: string | null
  } | null
}

export type ChannelAccessResolveResponse = {
  ok: boolean
  state: ChannelAccessState
  resource: string
  anchor_resource: string
  plan: string
  expires_at: string | null
  payment_url: string | null
  reason: string | null
  runtime_config: ChannelRuntimeConfig | null
  capabilities: {
    channel_access_version: string
    [key: string]: unknown
  }
}

export type LegacyEntitlementResponse = {
  active?: boolean
  reason?: string
  evaluated_plan?: string
  expires_at?: string | null
  payment_url?: string | null
  state?: string
  required?: Record<string, unknown> | null
}

export type SoulDefinition = {
  id: string
  name: string
  systemPrompt: string
  locale?: string
  memoryPolicy?: {
    keepRecentTurns: number
    summarizeAfterTurns: number
  }
  tools?: string[]
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

export interface MemoryStore {
  load(args: { userId: string; soulId: string }): Promise<SoulMemory>
  save(args: { userId: string; soulId: string; memory: SoulMemory }): Promise<void>
}

export interface SoulRuntime {
  run(args: {
    soul: SoulDefinition
    message: string
    memory: SoulMemory
    protocolSubjectHeader: string
    locale?: string
  }): Promise<SoulResponse>
}

export interface GuardToolClient {
  getChannelAccessState(args: {
    protocolSubjectHeader: string
    resource: string
    plan: string
  }): Promise<Record<string, unknown>>
  getEntitlements(args: {
    protocolSubjectHeader: string
    resource: string
    plan: string
  }): Promise<Record<string, unknown>>
  getRecentOrders?(args: {
    protocolSubjectHeader: string
  }): Promise<Record<string, unknown>>
  getRecentPayments?(args: {
    protocolSubjectHeader: string
  }): Promise<Record<string, unknown>>
}

export class InMemoryMemoryStore implements MemoryStore {
  private readonly store = new Map<string, SoulMemory>()

  async load(args: { userId: string; soulId: string }): Promise<SoulMemory> {
    return this.store.get(memoryKey(args.userId, args.soulId)) || emptyMemory()
  }

  async save(args: { userId: string; soulId: string; memory: SoulMemory }): Promise<void> {
    this.store.set(memoryKey(args.userId, args.soulId), args.memory)
  }
}

export class OpenAISoulRuntimeAdapter implements SoulRuntime {
  constructor(private readonly args: {
    runCompletion: (args: {
      system: string
      user: string
      locale?: string
      soul: SoulDefinition
    }) => Promise<SoulResponse>
  }) {}

  async run(args: {
    soul: SoulDefinition
    message: string
    memory: SoulMemory
    protocolSubjectHeader: string
    locale?: string
  }): Promise<SoulResponse> {
    const memorySummary = args.memory.summaries.join("\n") || "(no summary)"
    const recentTurns = args.memory.recentTurns.map((turn) => `${turn.role}: ${turn.content}`).join("\n") || "(no history)"
    return this.args.runCompletion({
      system: args.soul.systemPrompt,
      user: [
        `Protocol subject: ${args.protocolSubjectHeader}`,
        `Memory summary:\n${memorySummary}`,
        `Recent turns:\n${recentTurns}`,
        `Current message:\n${args.message}`,
      ].join("\n\n"),
      locale: args.locale,
      soul: args.soul,
    })
  }
}

export class StaticSoulRuntime implements SoulRuntime {
  constructor(private readonly reply: string) {}

  async run(): Promise<SoulResponse> {
    return { reply: this.reply }
  }
}

export function createGuardReadTools(client: GuardToolClient) {
  return {
    async getChannelAccessState(args: {
      protocolSubjectHeader: string
      resource: string
      plan: string
    }) {
      return client.getChannelAccessState(args)
    },
    async getEntitlements(args: {
      protocolSubjectHeader: string
      resource: string
      plan: string
    }) {
      return client.getEntitlements(args)
    },
    async getRecentOrders(args: { protocolSubjectHeader: string }) {
      return client.getRecentOrders?.(args) || {}
    },
    async getRecentPayments(args: { protocolSubjectHeader: string }) {
      return client.getRecentPayments?.(args) || {}
    },
  }
}

export function appendMemory(memory: SoulMemory, userMessage: string, assistantReply: string): SoulMemory {
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

export function buildAllowedAccessReply(args: {
  visitUrl?: string | null
  state: "paid_active" | "trial_active"
  expiresAt?: string
  language?: "de" | "en"
}): string {
  const language = args.language || "en"
  if (language === "de") {
    return [
      args.state === "trial_active"
        ? "Dein Zugang ist aktiv. Dein kostenloser Zugang laeuft aktuell."
        : "Dein Zugang ist aktiv.",
      args.expiresAt ? `Gueltig bis: ${args.expiresAt}.` : null,
      args.visitUrl ? `Direktlink: ${args.visitUrl}` : null,
    ].filter(Boolean).join("\n")
  }

  return [
    args.state === "trial_active"
      ? "Your access is active. Your free access is currently running."
      : "Your access is active.",
    args.expiresAt ? `Valid until: ${args.expiresAt}.` : null,
    args.visitUrl ? `Direct link: ${args.visitUrl}` : null,
  ].filter(Boolean).join("\n")
}

export function buildRuntimeErrorReply(
  error: "runtime_missing" | "agent_misconfigured",
  language: "de" | "en" = "en",
): string {
  if (language === "de") {
    if (error === "agent_misconfigured") {
      return "Dein Zugang ist aktiv, aber der Agent ist gerade nicht korrekt konfiguriert. Bitte spaeter erneut versuchen."
    }
    return "Dein Zugang ist aktiv, aber fuer diesen Kanal ist noch keine Laufzeit konfiguriert."
  }

  if (error === "agent_misconfigured") {
    return "Your access is active, but the agent is currently misconfigured. Please try again later."
  }
  return "Your access is active, but no runtime is configured for this channel yet."
}

function memoryKey(userId: string, soulId: string): string {
  return `${userId}::${soulId}`
}

function emptyMemory(): SoulMemory {
  return {
    recentTurns: [],
    summaries: [],
    updatedAt: new Date(0).toISOString(),
  }
}
