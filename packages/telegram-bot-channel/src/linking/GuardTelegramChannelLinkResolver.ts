import { GuardTelegramLinkService } from "./GuardTelegramLinkService.js"
import { TelegramLinkStore } from "./TelegramLinkStore.js"
import type { TelegramLinkResolver } from "@valuya/telegram-channel-access"

export class GuardTelegramChannelLinkResolver implements TelegramLinkResolver {
  private readonly service: GuardTelegramLinkService

  constructor(args: {
    baseUrl: string
    tenantToken: string
    channelAppId: string
    linksFile: string
    redeemedFrom?: string
  }) {
    const linkStore = new TelegramLinkStore(args.linksFile)
    this.service = new GuardTelegramLinkService({
      baseUrl: args.baseUrl,
      tenantToken: args.tenantToken,
      channelAppId: args.channelAppId,
      linkStore,
      redeemedFrom: args.redeemedFrom || "telegram_bot_channel",
    })
  }

  async ensureLinkedForPaymentAction(args: {
    telegramUserId: string
    telegramUsername?: string
  }) {
    return this.service.ensureLinkedForPaymentAction(args)
  }

  async redeemLinkToken(args: {
    telegramUserId: string
    linkToken: string
    telegramUsername?: string
  }): Promise<{
    linked: boolean
    code?: string
    reply: string
  }> {
    const result = await this.service.redeemLinkToken(args)
    if (!result.linked) {
      return {
        linked: false,
        code: result.code,
        reply: result.message,
      }
    }

    return {
      linked: true,
      reply: [
        "Konto erfolgreich verknuepft.",
        "",
        "Dein Zugang fuer diesen Telegram-Channel ist jetzt aktiv.",
        "Schreib mir einfach ganz normal. Wenn der Channel agent-moderiert ist, antworte ich dir direkt hier.",
      ].join("\n"),
    }
  }
}
