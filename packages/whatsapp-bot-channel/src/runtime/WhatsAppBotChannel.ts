import {
  InMemoryMemoryStore,
  WhatsAppChannelAccessService,
  WhatsAppChannelRuntime,
  type MemoryStore,
  type SoulRuntime,
  type WhatsAppChannelRuntimeResult,
} from "@valuya/whatsapp-channel-access"
import type { WhatsAppBotChannelConfig } from "../domain/types.js"

export class WhatsAppBotChannel {
  private readonly runtime: WhatsAppChannelRuntime
  private readonly humanReply?: string

  constructor(private readonly config: WhatsAppBotChannelConfig, deps?: {
    access?: WhatsAppChannelAccessService
    memoryStore?: MemoryStore
    soulRuntime?: SoulRuntime
  }) {
    const access = deps?.access || new WhatsAppChannelAccessService(config)
    const memoryStore = deps?.memoryStore || config.memoryStore || new InMemoryMemoryStore()
    const soulRuntime = deps?.soulRuntime || config.soulRuntime

    this.runtime = new WhatsAppChannelRuntime({
      access,
      mode: config.mode,
      memoryStore,
      soulRuntime,
      souls: config.souls,
      logger: config.logger,
    })
    this.humanReply = config.humanReply
  }

  async handleMessage(args: {
    whatsappUserId: string
    body: string
    profileName?: string
    locale?: string
  }): Promise<WhatsAppChannelRuntimeResult> {
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
