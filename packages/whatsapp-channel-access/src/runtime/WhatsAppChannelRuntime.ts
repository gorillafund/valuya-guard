import type {
  ChannelMode,
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
          buildHumanHandoffReply(),
          access.runtimeConfig?.visit_url ? `Direktlink: ${access.runtimeConfig.visit_url}` : null,
        ].filter(Boolean).join("\n"),
      }
    }

    const soul = resolvedMode.soul
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
    const bySlug = this.deps.souls?.find((entry) => entry.id === soulConfig.slug)
    if (bySlug) return bySlug
    const byId = this.deps.souls?.find((entry) => entry.id === String(soulConfig.id))
    if (byId) return byId
    return null
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
