import type {
  ChannelMode,
  MemoryStore,
  SoulDefinition,
  SoulResponse,
  SoulRuntime,
  TelegramChannelAccessConfig,
  TelegramChannelRuntimeResult,
} from "@valuya/telegram-channel-access"
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

export type TelegramBotChannelConfig = TelegramChannelAccessConfig & {
  mode?: ChannelMode
  souls?: ChannelSoulDefinition[]
  memoryStore?: MemoryStore
  soulRuntime?: SoulRuntime
  humanReply?: string
}
