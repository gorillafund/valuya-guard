import {
  BotChannelApp,
  extractLinkCommandToken,
} from "@valuya/bot-channel-app-core"
import type { WhatsAppBotChannel } from "../runtime/WhatsAppBotChannel.js"
import type { GuardWhatsAppChannelLinkResolver } from "../linking/GuardWhatsAppChannelLinkResolver.js"

export class WhatsAppBotChannelApp {
  private readonly app: BotChannelApp<
    {
      whatsappUserId: string
      body: string
      profileName?: string
      locale?: string
    },
    {
      whatsappUserId: string
      body: string
      profileName?: string
      locale?: string
    },
    Awaited<ReturnType<WhatsAppBotChannel["handleMessage"]>>,
    {
      whatsappUserId: string
      linkToken: string
      whatsappProfileName?: string
    }
  >

  constructor(private readonly deps: {
    channel: WhatsAppBotChannel
    linkResolver: GuardWhatsAppChannelLinkResolver
  }) {
    this.app = new BotChannelApp({
      channel: deps.channel,
      linkResolver: deps.linkResolver,
      extractLinkToken: (args) => extractLinkCommandToken(args.body),
      buildLinkArgs: (args, linkToken) => ({
        whatsappUserId: args.whatsappUserId,
        linkToken,
        whatsappProfileName: args.profileName,
      }),
      buildChannelArgs: (args) => args,
      getChannelReply: (result) => result.reply,
      getChannelMetadata: (result) => ({
        kind: result.kind,
        ...(result.kind === "agent" ? { soulId: result.soulId } : {}),
      }),
      getLinkMetadata: (result) => ({
        linkAttempt: true,
        linked: result.linked,
        ...(result.code ? { code: result.code } : {}),
      }),
    })
  }

  async handleInboundMessage(args: {
    whatsappUserId: string
    body: string
    profileName?: string
    locale?: string
  }): Promise<{
    reply: string
    metadata?: Record<string, unknown>
  }> {
    return this.app.handleInboundMessage(args)
  }
}
