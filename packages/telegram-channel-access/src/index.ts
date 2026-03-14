export type LogFn = (event: string, fields: Record<string, unknown>) => void

export type ChannelAccessState =
  | "paid_active"
  | "trial_active"
  | "expired_payment_required"
  | "inactive"

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
  soul: {
    id: number | string
    slug: string
    name: string
    version: number | string
  } | null
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

export type TelegramLinkResolver = {
  ensureLinkedForPaymentAction(args: {
    telegramUserId: string
    telegramUsername?: string
  }): Promise<
    | {
        allowed: true
        link: {
          valuya_protocol_subject_header?: string
        }
      }
    | {
        allowed: false
        code: string
        reply: string
      }
  >
}

export type TelegramChannelAccessConfig = {
  baseUrl: string
  tenantToken: string
  linking: TelegramLinkResolver
  channelResource?: string
  channelBot?: string
  channelName?: string
  channelPlan?: string
  channelInviteUrl?: string
  logger?: LogFn
  allowEntitlementFallbackOnServerError?: boolean
}

export type ChannelMode =
  | { kind: "human" }
  | { kind: "agent"; soulId: string }

export type TelegramChannelRuntimeConfig = TelegramChannelAccessConfig & {
  mode?: ChannelMode
  souls?: SoulDefinition[]
}

export type TelegramChannelAccessResult =
  | {
      allowed: true
      state: "paid_active" | "trial_active"
      protocolSubjectHeader: string
      resource: string
      anchorResource: string
      plan: string
      joinUrl: string | null
      expiresAt?: string
      paymentUrl?: string | null
      runtimeConfig: ChannelRuntimeConfig | null
      capabilities: {
        channel_access_version: string
        [key: string]: unknown
      } | null
      source: "channel_access_resolve" | "entitlements_fallback"
    }
  | {
      allowed: false
      state: "not_linked" | "expired_payment_required" | "inactive" | "guard_unavailable"
      protocolSubjectHeader: string | null
      resource: string
      anchorResource: string
      plan: string
      reply: string
      expiresAt?: string
      paymentUrl?: string | null
      runtimeConfig: ChannelRuntimeConfig | null
      capabilities: {
        channel_access_version: string
        [key: string]: unknown
      } | null
      source: "channel_access_resolve" | "entitlements_fallback" | "linking"
    }

export type TelegramChannelRuntimeResult =
  | {
      kind: "blocked"
      access: TelegramChannelAccessResult & { allowed: false }
      reply: string
    }
  | {
      kind: "human"
      access: TelegramChannelAccessResult & { allowed: true }
      protocolSubjectHeader: string
      reply: string
    }
  | {
      kind: "allowed"
      access: TelegramChannelAccessResult & { allowed: true }
      protocolSubjectHeader: string
      reply: string
    }
  | {
      kind: "agent"
      access: TelegramChannelAccessResult & { allowed: true }
      protocolSubjectHeader: string
      soulId: string
      reply: string
      metadata?: Record<string, unknown>
    }
  | {
      kind: "runtime_error"
      access: TelegramChannelAccessResult & { allowed: true }
      protocolSubjectHeader: string
      error: "runtime_missing" | "agent_misconfigured"
      reply: string
    }

export interface MemoryStore {
  load(args: { telegramUserId: string; soulId: string }): Promise<SoulMemory>
  save(args: { telegramUserId: string; soulId: string; memory: SoulMemory }): Promise<void>
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

type LinkedGate =
  | {
      allowed: true
      link: {
        valuya_protocol_subject_header?: string
      }
    }
  | {
      allowed: false
      reply: string
      code: string
    }

export class TelegramChannelAccessService {
  private readonly baseUrl: string
  private readonly tenantToken: string
  private readonly linking: TelegramLinkResolver
  private readonly resource: string
  private readonly plan: string
  private readonly inviteUrl: string | null
  private readonly log: LogFn
  private readonly channelMetadata: ChannelAccessResolveRequest["channel"]
  private readonly allowEntitlementFallbackOnServerError: boolean

  constructor(config: TelegramChannelAccessConfig) {
    this.baseUrl = String(config.baseUrl || "").trim().replace(/\/+$/, "")
    this.tenantToken = String(config.tenantToken || "").trim()
    this.linking = config.linking
    this.resource = buildTelegramChannelResource({
      resource: config.channelResource,
      bot: config.channelBot,
      channel: config.channelName,
    })
    this.plan = String(config.channelPlan || "standard").trim() || "standard"
    this.inviteUrl = cleanOptional(config.channelInviteUrl) || null
    this.channelMetadata = {
      kind: "telegram",
      provider: null,
      channel_identifier: cleanOptional(config.channelName) || null,
      phone_number: null,
      bot_name: cleanOptional(config.channelBot) || null,
      chat_id: null,
    }
    this.allowEntitlementFallbackOnServerError = config.allowEntitlementFallbackOnServerError === true
    this.log =
      config.logger ||
      ((event, fields) => {
        console.log(JSON.stringify({ level: "info", event, ...fields }))
      })

    if (!this.baseUrl) throw new Error("telegram_channel_base_url_required")
    if (!this.tenantToken) throw new Error("telegram_channel_tenant_token_required")
  }

  async resolveAccess(args: {
    telegramUserId: string
    telegramUsername?: string
  }): Promise<TelegramChannelAccessResult> {
    const telegramUserId = String(args.telegramUserId || "").trim()
    this.log("telegram_channel_access_request", {
      tenant: tokenPreview(this.tenantToken),
      telegram_user_id: telegramUserId,
      resource: this.resource,
      plan: this.plan,
    })

    const linked = (await this.linking.ensureLinkedForPaymentAction({
      telegramUserId,
      telegramUsername: args.telegramUsername,
    })) as LinkedGate

    if (!linked.allowed) {
      return {
        allowed: false,
        state: linked.code === "not_linked" ? "not_linked" : "guard_unavailable",
        protocolSubjectHeader: null,
        resource: this.resource,
        anchorResource: this.resource,
        plan: this.plan,
        reply: linked.reply,
        runtimeConfig: null,
        capabilities: null,
        source: "linking",
      }
    }

    const protocolSubjectHeader = String(linked.link.valuya_protocol_subject_header || "").trim()
    if (!protocolSubjectHeader) {
      return {
        allowed: false,
        state: "guard_unavailable",
        protocolSubjectHeader: null,
        resource: this.resource,
        anchorResource: this.resource,
        plan: this.plan,
        reply: "Linked subject is missing. Please run onboarding /start again.",
        runtimeConfig: null,
        capabilities: null,
        source: "linking",
      }
    }

    const resolution = await this.resolveFromGuard({
      protocolSubjectHeader,
      resource: this.resource,
      plan: this.plan,
    })

    const base = {
      protocolSubjectHeader,
      resource: resolution.resource,
      anchorResource: resolution.anchor_resource,
      plan: resolution.plan,
      runtimeConfig: resolution.runtime_config,
      capabilities: resolution.capabilities,
      source: resolution.source,
    } as const

    if (resolution.state === "paid_active" || resolution.state === "trial_active") {
      return {
        allowed: true,
        state: resolution.state,
        joinUrl: this.inviteUrl,
        ...(resolution.expires_at ? { expiresAt: resolution.expires_at } : {}),
        ...(resolution.payment_url ? { paymentUrl: resolution.payment_url } : {}),
        ...base,
      }
    }

    return {
      allowed: false,
      state: resolution.state,
      reply: buildBlockedReply(resolution),
      ...(resolution.expires_at ? { expiresAt: resolution.expires_at } : {}),
      ...(resolution.payment_url ? { paymentUrl: resolution.payment_url } : {}),
      ...base,
    }
  }

  private async resolveFromGuard(args: {
    protocolSubjectHeader: string
    resource: string
    plan: string
  }): Promise<ChannelAccessResolveResponse & { source: "channel_access_resolve" | "entitlements_fallback" }> {
    const response = await fetch(`${this.baseUrl}/api/v2/channel-access/resolve`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.tenantToken}`,
        Accept: "application/json",
        "Content-Type": "application/json",
        "X-Valuya-Subject-Id": args.protocolSubjectHeader,
      },
      body: JSON.stringify({
        resource: args.resource,
        plan: args.plan,
        channel: this.channelMetadata,
      } satisfies ChannelAccessResolveRequest),
    })
    const body = await safeParseJson(response)
    if (!response.ok) {
      if (shouldFallback(response.status, body, this.allowEntitlementFallbackOnServerError)) {
        return this.resolveFromEntitlements(args)
      }
      throw new Error(
        `telegram_channel_access_resolve_failed:${response.status}:${JSON.stringify(body).slice(0, 300)}`,
      )
    }

    return {
      ...normalizeResolveResponse(body, args.resource, args.plan),
      source: "channel_access_resolve",
    }
  }

  private async resolveFromEntitlements(args: {
    protocolSubjectHeader: string
    resource: string
    plan: string
  }): Promise<ChannelAccessResolveResponse & { source: "entitlements_fallback" }> {
    const url = new URL(`${this.baseUrl}/api/v2/entitlements`)
    url.searchParams.set("resource", args.resource)
    url.searchParams.set("plan", args.plan)

    const response = await fetch(url.toString(), {
      method: "GET",
      headers: {
        Authorization: `Bearer ${this.tenantToken}`,
        Accept: "application/json",
        "X-Valuya-Subject-Id": args.protocolSubjectHeader,
      },
    })
    const body = await safeParseJson(response)
    if (!response.ok) {
      throw new Error(
        `telegram_channel_entitlement_failed:${response.status}:${JSON.stringify(body).slice(0, 300)}`,
      )
    }
    return {
      ...normalizeLegacyEntitlement(body, args.resource, args.plan),
      source: "entitlements_fallback",
    }
  }
}

export class InMemoryMemoryStore implements MemoryStore {
  private readonly store = new Map<string, SoulMemory>()

  async load(args: { telegramUserId: string; soulId: string }): Promise<SoulMemory> {
    return this.store.get(memoryKey(args.telegramUserId, args.soulId)) || emptyMemory()
  }

  async save(args: { telegramUserId: string; soulId: string; memory: SoulMemory }): Promise<void> {
    this.store.set(memoryKey(args.telegramUserId, args.soulId), args.memory)
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

export class TelegramChannelRuntime {
  constructor(private readonly deps: {
    access: TelegramChannelAccessService
    mode?: ChannelMode
    memoryStore: MemoryStore
    soulRuntime?: SoulRuntime
    souls?: SoulDefinition[]
  }) {}

  async handleMessage(args: {
    telegramUserId: string
    body: string
    username?: string
    locale?: string
  }): Promise<TelegramChannelRuntimeResult> {
    const access = await this.deps.access.resolveAccess({
      telegramUserId: args.telegramUserId,
      telegramUsername: args.username,
    })
    if (!access.allowed) {
      return {
        kind: "blocked",
        access,
        reply: buildBlockedAccessReply(access),
      }
    }

    const resolvedMode = this.resolveMode(access)
    if (resolvedMode.kind === "none") {
      return {
        kind: "allowed",
        access,
        protocolSubjectHeader: access.protocolSubjectHeader,
        reply: buildAllowedAccessReply({
          state: access.state,
          expiresAt: access.expiresAt,
          visitUrl: access.runtimeConfig?.visit_url || access.joinUrl || null,
        }),
      }
    }

    if (resolvedMode.kind === "runtime_error") {
      return {
        kind: "runtime_error",
        access,
        protocolSubjectHeader: access.protocolSubjectHeader,
        error: resolvedMode.error,
        reply: buildRuntimeErrorReply(resolvedMode.error),
      }
    }

    if (resolvedMode.kind === "human") {
      return {
        kind: "human",
        access,
        protocolSubjectHeader: access.protocolSubjectHeader,
        reply: [
          "Your access is active. Your message has been forwarded to the human channel.",
          access.runtimeConfig?.visit_url ? `Direct link: ${access.runtimeConfig.visit_url}` : null,
        ].filter(Boolean).join("\n"),
      }
    }

    if (!this.deps.soulRuntime) throw new Error("telegram_channel_soul_runtime_missing")
    const soul = resolvedMode.soul
    const memory = await this.deps.memoryStore.load({
      telegramUserId: args.telegramUserId,
      soulId: soul.id,
    })
    const result = await this.deps.soulRuntime.run({
      soul,
      message: args.body,
      memory,
      protocolSubjectHeader: access.protocolSubjectHeader,
      locale: args.locale || soul.locale,
    })
    await this.deps.memoryStore.save({
      telegramUserId: args.telegramUserId,
      soulId: soul.id,
      memory: result.memory || appendMemory(memory, args.body, result.reply),
    })

    return {
      kind: "agent",
      access,
      protocolSubjectHeader: access.protocolSubjectHeader,
      soulId: soul.id,
      reply: result.reply,
      metadata: result.metadata,
    }
  }

  private resolveMode(
    access: Extract<TelegramChannelAccessResult, { allowed: true }>,
  ):
    | { kind: "none" }
    | { kind: "human" }
    | { kind: "agent"; soul: SoulDefinition }
    | { kind: "runtime_error"; error: "runtime_missing" | "agent_misconfigured" } {
    const runtimeConfig = access.runtimeConfig
    if (!runtimeConfig) {
      if (!this.deps.mode) return { kind: "none" }
      if (this.deps.mode.kind === "human") return { kind: "human" }
      const soulId = this.deps.mode.soulId
      const soul = this.deps.souls?.find((entry) => entry.id === soulId)
      return soul ? { kind: "agent", soul } : { kind: "runtime_error", error: "agent_misconfigured" }
    }

    if (runtimeConfig.mode === "human") return { kind: "human" }
    if (!runtimeConfig.soul) {
      if (runtimeConfig.fallback?.allowed && runtimeConfig.fallback.mode === "human") return { kind: "human" }
      return { kind: "runtime_error", error: "agent_misconfigured" }
    }
    const soul = this.matchSoulDefinition(runtimeConfig.soul)
    if (!soul) {
      if (runtimeConfig.fallback?.allowed && runtimeConfig.fallback.mode === "human") return { kind: "human" }
      return { kind: "runtime_error", error: "agent_misconfigured" }
    }
    return { kind: "agent", soul }
  }

  private matchSoulDefinition(soulConfig: NonNullable<ChannelRuntimeConfig["soul"]>): SoulDefinition | null {
    const bySlug = this.deps.souls?.find((entry) => entry.id === soulConfig.slug)
    if (bySlug) return bySlug
    const byId = this.deps.souls?.find((entry) => entry.id === String(soulConfig.id))
    if (byId) return byId
    return null
  }
}

export function buildTelegramChannelResource(args: {
  resource?: string
  bot?: string
  channel?: string
}): string {
  const explicit = cleanOptional(args.resource)
  if (explicit) return explicit

  const bot = cleanOptional(args.bot)
  const channel = cleanOptional(args.channel)
  if (!bot || !channel) {
    throw new Error("telegram_channel_resource_config_missing")
  }
  return `telegram:channel:${bot}:${channel}`
}

function normalizeResolveResponse(
  body: unknown,
  resource: string,
  plan: string,
): ChannelAccessResolveResponse {
  const record = body && typeof body === "object" ? (body as Record<string, unknown>) : {}
  return {
    ok: record.ok !== false,
    state: normalizeState(record.state),
    resource: readString(record.resource) || resource,
    anchor_resource: readString(record.anchor_resource) || readString(record.resource) || resource,
    plan: readString(record.plan) || plan,
    expires_at: readString(record.expires_at) || null,
    payment_url: readString(record.payment_url) || null,
    reason: readString(record.reason) || null,
    runtime_config: readRuntimeConfig(record.runtime_config),
    capabilities: readCapabilities(record.capabilities),
  }
}

function normalizeLegacyEntitlement(
  body: unknown,
  resource: string,
  plan: string,
): ChannelAccessResolveResponse {
  const record = body && typeof body === "object" ? (body as LegacyEntitlementResponse) : {}
  return {
    ok: true,
    state: record.active === true ? "paid_active" : "inactive",
    resource,
    anchor_resource: resource,
    plan,
    expires_at: readString(record.expires_at) || null,
    payment_url: readString(record.payment_url) || null,
    reason: readString(record.reason) || null,
    runtime_config: null,
    capabilities: {
      channel_access_version: "fallback-entitlements",
    },
  }
}

function normalizeState(value: unknown): ChannelAccessState {
  const v = readString(value)
  if (v === "paid_active" || v === "trial_active" || v === "expired_payment_required" || v === "inactive") {
    return v
  }
  return "inactive"
}

function readRuntimeConfig(value: unknown): ChannelRuntimeConfig | null {
  if (!value || typeof value !== "object") return null
  const record = value as Record<string, unknown>
  const mode = readString(record.mode)
  const channel = readString(record.channel)
  const channelKind = readString(record.channel_kind)
  if ((mode !== "human" && mode !== "agent") || !channel || !channelKind) return null
  const soul = readSoul(record.soul)
  return {
    mode,
    channel,
    channel_kind: channelKind,
    provider: readString(record.provider) || null,
    channel_app_id: readString(record.channel_app_id) || null,
    visit_url: readString(record.visit_url) || null,
    human_routing: asRecord(record.human_routing),
    agent_routing: asRecord(record.agent_routing),
    fallback: readFallback(record.fallback),
    soul,
  }
}

function readSoul(value: unknown): ChannelRuntimeConfig["soul"] {
  if (!value || typeof value !== "object") return null
  const record = value as Record<string, unknown>
  const id = record.id
  const slug = readString(record.slug)
  const name = readString(record.name)
  const version = record.version
  if ((typeof id !== "string" && typeof id !== "number") || !slug || !name || (typeof version !== "string" && typeof version !== "number")) {
    return null
  }
  return { id, slug, name, version }
}

function readFallback(value: unknown): ChannelRuntimeConfig["fallback"] {
  if (!value || typeof value !== "object") return null
  const record = value as Record<string, unknown>
  return record.allowed === true && readString(record.mode) === "human"
    ? { allowed: true, mode: "human" }
    : null
}

function readCapabilities(value: unknown): ChannelAccessResolveResponse["capabilities"] {
  const record = value && typeof value === "object" ? (value as Record<string, unknown>) : {}
  return {
    channel_access_version: readString(record.channel_access_version) || "1",
    ...record,
  }
}

function buildBlockedReply(response: ChannelAccessResolveResponse): string {
  if (response.state === "expired_payment_required") {
    return [
      "Access to this Telegram channel requires payment.",
      response.expires_at ? `Trial expired at: ${response.expires_at}` : null,
      response.payment_url ? `Payment link: ${response.payment_url}` : null,
    ].filter(Boolean).join("\n")
  }
  return [
    "Access to this Telegram channel is currently unavailable.",
    response.payment_url ? `Payment link: ${response.payment_url}` : null,
  ].filter(Boolean).join("\n")
}

function shouldFallback(status: number, body: unknown, allowServerErrorFallback: boolean): boolean {
  if (status === 404 || status === 501 || status === 503) return true
  const errorCode =
    body && typeof body === "object" ? readString((body as Record<string, unknown>).error) : undefined
  if (errorCode === "channel_access_not_available") return true
  if (allowServerErrorFallback && status >= 500) return true
  return false
}

async function safeParseJson(response: Response): Promise<unknown> {
  const text = await response.text()
  if (!text) return {}
  try {
    return JSON.parse(text)
  } catch {
    return { raw: text }
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null
}

function cleanOptional(value: unknown): string | undefined {
  const v = String(value || "").trim()
  return v || undefined
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined
}

function tokenPreview(token: string): string {
  const t = String(token || "").trim()
  return t ? t.slice(0, 12) : "unknown"
}

function memoryKey(telegramUserId: string, soulId: string): string {
  return `${telegramUserId}::${soulId}`
}

function emptyMemory(): SoulMemory {
  return {
    recentTurns: [],
    summaries: [],
    updatedAt: new Date(0).toISOString(),
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

function buildBlockedAccessReply(decision: Extract<TelegramChannelAccessResult, { allowed: false }>): string {
  switch (decision.state) {
    case "not_linked":
      return decision.reply
    case "expired_payment_required":
      return [
        decision.reply,
        decision.expiresAt ? `Free access ended at ${decision.expiresAt}.` : null,
        decision.paymentUrl ? `Payment link: ${decision.paymentUrl}` : null,
      ].filter(Boolean).join("\n")
    case "inactive":
      return [
        decision.reply,
        decision.paymentUrl ? `Payment link: ${decision.paymentUrl}` : null,
      ].filter(Boolean).join("\n")
    case "guard_unavailable":
    default:
      return decision.reply
  }
}

function buildAllowedAccessReply(args: {
  visitUrl?: string | null
  state: "paid_active" | "trial_active"
  expiresAt?: string
}): string {
  return [
    args.state === "trial_active"
      ? "Your access is active. Your free access is currently running."
      : "Your access is active.",
    args.expiresAt ? `Valid until: ${args.expiresAt}.` : null,
    args.visitUrl ? `Direct link: ${args.visitUrl}` : null,
  ].filter(Boolean).join("\n")
}

function buildRuntimeErrorReply(error: "runtime_missing" | "agent_misconfigured"): string {
  if (error === "agent_misconfigured") {
    return "Your access is active, but the agent is currently misconfigured. Please try again later."
  }
  return "Your access is active, but no runtime is configured for this channel yet."
}
