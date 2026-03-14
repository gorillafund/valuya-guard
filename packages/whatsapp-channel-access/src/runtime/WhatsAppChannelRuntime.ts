import type {
  ChannelMode,
  LogFn,
  SoulConfig,
  SoulDefinition,
  SoulMemory,
  WhatsAppChannelRuntimeResult,
} from "../domain/types.js"
import type { WhatsAppChannelAccessService } from "../access/WhatsAppChannelAccessService.js"
import type { MemoryStore } from "../memory/MemoryStore.js"
import type { SoulRuntime } from "./SoulRuntime.js"
import {
  buildAllowedAccessReply,
  buildBlockedAccessReply,
  buildHumanHandoffReply,
  buildRuntimeErrorReply,
} from "../access/replyBuilders.js"

export class WhatsAppChannelRuntime {
  constructor(private readonly deps: {
    access: WhatsAppChannelAccessService
    mode?: ChannelMode
    memoryStore: MemoryStore
    soulRuntime?: SoulRuntime
    souls?: SoulDefinition[]
    logger?: LogFn
  }) {}

  async handleMessage(args: {
    whatsappUserId: string
    body: string
    profileName?: string
    locale?: string
  }): Promise<WhatsAppChannelRuntimeResult> {
    const access = await this.deps.access.resolveAccess({
      whatsappUserId: args.whatsappUserId,
      whatsappProfileName: args.profileName,
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
      this.logRuntimeDecision(args, access, {
        runtime_kind: "allowed",
        backend_runtime_config_present: access.runtimeConfig ? true : false,
      })
      return {
        kind: "allowed",
        access,
        protocolSubjectHeader: access.protocolSubjectHeader,
        reply: buildAllowedAccessReply({
          state: access.state,
          expiresAt: access.expiresAt,
          visitUrl: access.runtimeConfig?.visit_url || access.channelUrl || null,
        }),
      }
    }

    if (resolvedMode.kind === "runtime_error") {
      this.logRuntimeDecision(args, access, {
        runtime_kind: "runtime_error",
        runtime_error: resolvedMode.error,
        backend_runtime_config_present: access.runtimeConfig ? true : false,
        backend_runtime_mode: access.runtimeConfig?.mode || null,
        backend_soul_slug: access.runtimeConfig?.soul?.slug || null,
        backend_soul_id: access.runtimeConfig?.soul?.id || null,
        local_configured_soul_ids: this.deps.souls?.map((entry) => entry.id) || [],
      })
      return {
        kind: "runtime_error",
        access,
        protocolSubjectHeader: access.protocolSubjectHeader,
        error: resolvedMode.error,
        reply: buildRuntimeErrorReply(resolvedMode.error),
      }
    }

    if (resolvedMode.kind === "human") {
      this.logRuntimeDecision(args, access, {
        runtime_kind: "human",
        backend_runtime_config_present: access.runtimeConfig ? true : false,
        backend_runtime_mode: access.runtimeConfig?.mode || null,
      })
      return {
        kind: "human",
        access,
        protocolSubjectHeader: access.protocolSubjectHeader,
        reply: [
          buildHumanHandoffReply(),
          access.runtimeConfig?.visit_url ? `Direktlink: ${access.runtimeConfig.visit_url}` : null,
        ].filter(Boolean).join("\n"),
      }
    }

    const soul = resolvedMode.soul
    this.logRuntimeDecision(args, access, {
      runtime_kind: "agent",
      backend_runtime_config_present: access.runtimeConfig ? true : false,
      backend_runtime_mode: access.runtimeConfig?.mode || null,
      matched_soul_id: soul.id,
      matched_soul_name: soul.name,
    })
    if (!this.deps.soulRuntime) throw new Error("whatsapp_channel_soul_runtime_missing")

    const memory = await this.deps.memoryStore.load({
      whatsappUserId: args.whatsappUserId,
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
      whatsappUserId: args.whatsappUserId,
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
    access: Extract<Awaited<ReturnType<WhatsAppChannelAccessService["resolveAccess"]>>, { allowed: true }>,
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
    const soulConfig = runtimeConfig.soul
    if (!soulConfig) {
      if (runtimeConfig.fallback?.allowed && runtimeConfig.fallback.mode === "human") return { kind: "human" }
      return { kind: "runtime_error", error: "agent_misconfigured" }
    }
    const soul = this.matchSoulDefinition(soulConfig)
    if (!soul) {
      if (runtimeConfig.fallback?.allowed && runtimeConfig.fallback.mode === "human") return { kind: "human" }
      return { kind: "runtime_error", error: "agent_misconfigured" }
    }
    return { kind: "agent", soul }
  }

  private matchSoulDefinition(soulConfig: SoulConfig): SoulDefinition | null {
    const normalizedSlug = normalizeSoulKey(soulConfig.slug)
    const bySlug = this.deps.souls?.find((entry) => normalizeSoulKey(entry.id) === normalizedSlug)
    if (bySlug) return bySlug
    const normalizedId = normalizeSoulKey(String(soulConfig.id))
    const byId = this.deps.souls?.find((entry) => normalizeSoulKey(entry.id) === normalizedId)
    if (byId) return byId
    const normalizedName = normalizeSoulKey(soulConfig.name)
    const byName = this.deps.souls?.find((entry) => normalizeSoulKey(entry.name) === normalizedName)
    if (byName) return byName
    return null
  }

  private logRuntimeDecision(
    args: {
      whatsappUserId: string
      body: string
      profileName?: string
      locale?: string
    },
    access: Extract<Awaited<ReturnType<WhatsAppChannelAccessService["resolveAccess"]>>, { allowed: true }>,
    extra: Record<string, unknown>,
  ): void {
    this.deps.logger?.("whatsapp_channel_runtime_decision", {
      whatsapp_user_id: args.whatsappUserId,
      protocol_subject_header: access.protocolSubjectHeader,
      resource: access.resource,
      plan: access.plan,
      body_preview: args.body.slice(0, 120),
      ...extra,
    })
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

function normalizeSoulKey(value: string): string {
  return String(value || "").trim().toLowerCase()
}
