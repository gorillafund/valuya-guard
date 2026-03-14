export { WhatsAppChannelAccessService } from "./access/WhatsAppChannelAccessService.js"
export { GuardChannelMandateResolver } from "./access/GuardChannelMandateResolver.js"
export { buildWhatsAppChannelResource } from "./index.helpers.js"
export { WhatsAppChannelRuntime } from "./runtime/WhatsAppChannelRuntime.js"
export { InMemoryMemoryStore } from "./memory/InMemoryMemoryStore.js"
export { OpenAISoulRuntimeAdapter } from "./adapters/OpenAISoulRuntimeAdapter.js"
export { createGuardReadTools } from "./tools/GuardReadTools.js"

export type {
  WhatsAppChannelAccessConfig,
  WhatsAppChannelRuntimeConfig,
} from "./domain/channelConfig.js"
export type {
  AccessState,
  ChannelAccessResolveRequest,
  ChannelAccessResolveResponse,
  ChannelAccessState,
  ChannelRuntimeConfig,
  ChannelMode,
  LegacyEntitlementResponse,
  SoulConfig,
  SoulDefinition,
  SoulMemory,
  SoulMemoryTurn,
  SoulResponse,
  WhatsAppLinkResolver,
  WhatsAppChannelAccessDecision,
  WhatsAppChannelRuntimeResult,
} from "./domain/types.js"
export type { ChannelMandateResolver } from "./access/ChannelMandateResolver.js"
export type { MemoryStore } from "./memory/MemoryStore.js"
export type { GuardToolClient } from "./tools/GuardToolClient.js"
export type { SoulRuntime } from "./runtime/SoulRuntime.js"
