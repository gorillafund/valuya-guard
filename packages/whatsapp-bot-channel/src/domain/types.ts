import type {
  ChannelMode,
  MemoryStore,
  SoulDefinition,
  SoulResponse,
  SoulRuntime,
  WhatsAppChannelAccessConfig,
  WhatsAppChannelRuntimeResult,
} from "@valuya/whatsapp-channel-access"
import type {
  ChannelSoulDefinition as CoreChannelSoulDefinition,
  SoulResponseSchema as CoreSoulResponseSchema,
  StructuredCompletionResult as CoreStructuredCompletionResult,
  StructuredCompletionRunner as CoreStructuredCompletionRunner,
} from "@valuya/bot-channel-core"

export type SoulResponseSchema = CoreSoulResponseSchema

export type ChannelSoulDefinition = SoulDefinition & CoreChannelSoulDefinition

export type StructuredCompletionResult = CoreStructuredCompletionResult | SoulResponse

export type StructuredCompletionRunner = CoreStructuredCompletionRunner

export type WhatsAppBotChannelConfig = WhatsAppChannelAccessConfig & {
  mode: ChannelMode
  souls?: ChannelSoulDefinition[]
  memoryStore?: MemoryStore
  soulRuntime?: SoulRuntime
  humanReply?: string
}

export type WhatsAppBotChannelResult = WhatsAppChannelRuntimeResult
