import {
  InMemoryMemoryStore,
  TelegramChannelAccessService,
  TelegramChannelRuntime,
  type MemoryStore,
  type SoulRuntime,
  type TelegramChannelRuntimeResult,
} from "@valuya/telegram-channel-access"
import type { TelegramBotChannelConfig } from "../domain/types.js"

export class TelegramBotChannel {
  private readonly runtime: TelegramChannelRuntime
  private readonly humanReply?: string

  constructor(private readonly config: TelegramBotChannelConfig, deps?: {
    access?: TelegramChannelAccessService
    memoryStore?: MemoryStore
    soulRuntime?: SoulRuntime
  }) {
    const access = deps?.access || new TelegramChannelAccessService(config)
    const memoryStore = deps?.memoryStore || config.memoryStore || new InMemoryMemoryStore()
    const soulRuntime = deps?.soulRuntime || config.soulRuntime

    this.runtime = new TelegramChannelRuntime({
      access,
      mode: config.mode,
      memoryStore,
      soulRuntime,
      souls: config.souls,
    })
    this.humanReply = config.humanReply
  }

  async handleMessage(args: {
    telegramUserId: string
    body: string
    telegramUsername?: string
    locale?: string
  }): Promise<TelegramChannelRuntimeResult> {
    const result = await this.runtime.handleMessage(args)
    if (result.kind === "human" && this.humanReply) {
      return {
        ...result,
        reply: this.humanReply,
      }
    }
    return result
  }
}
