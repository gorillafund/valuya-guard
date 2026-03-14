export { WhatsAppBotChannel } from "./runtime/WhatsAppBotChannel.js"
export { SchemaDrivenSoulRuntime } from "./runtime/SchemaDrivenSoulRuntime.js"
export { FileSoulMemoryStore } from "./memory/FileSoulMemoryStore.js"
export { createMentorSoulDefinition } from "./souls/createMentorSoulDefinition.js"
export { WhatsAppBotChannelApp } from "./app/WhatsAppBotChannelApp.js"
export { GuardWhatsAppChannelLinkResolver } from "./linking/GuardWhatsAppChannelLinkResolver.js"

export type {
  ChannelSoulDefinition,
  SoulResponseSchema,
  StructuredCompletionResult,
  StructuredCompletionRunner,
  WhatsAppBotChannelConfig,
} from "./domain/types.js"
