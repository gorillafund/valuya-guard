import {
  BotChannelApp,
  extractLinkCommandToken,
  extractTelegramStartToken,
} from "@valuya/bot-channel-app-core"
import type { TelegramBotChannel } from "../runtime/TelegramBotChannel.js"
import type { GuardTelegramChannelLinkResolver } from "../linking/GuardTelegramChannelLinkResolver.js"

function extractTelegramLinkToken(body: string): string | null {
  return extractTelegramStartToken(body) || extractLinkCommandToken(body)
}

export class TelegramBotChannelApp {
  private readonly app: BotChannelApp<
    {
      telegramUserId: string
      body: string
      telegramUsername?: string
      locale?: string
    },
    {
      telegramUserId: string
      body: string
      telegramUsername?: string
      locale?: string
    },
    Awaited<ReturnType<TelegramBotChannel["handleMessage"]>>,
    {
      telegramUserId: string
      linkToken: string
      telegramUsername?: string
    }
  >

  constructor(private readonly deps: {
    channel: TelegramBotChannel
    linkResolver: GuardTelegramChannelLinkResolver
  }) {
    this.app = new BotChannelApp({
      channel: deps.channel,
      linkResolver: deps.linkResolver,
      extractLinkToken: (args) => extractTelegramLinkToken(args.body),
      buildLinkArgs: (args, linkToken) => ({
        telegramUserId: args.telegramUserId,
        linkToken,
        telegramUsername: args.telegramUsername,
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
    telegramUserId: string
    body: string
    telegramUsername?: string
    locale?: string
  }): Promise<{
    reply: string
    metadata?: Record<string, unknown>
  }> {
    return this.app.handleInboundMessage(args)
  }
}
