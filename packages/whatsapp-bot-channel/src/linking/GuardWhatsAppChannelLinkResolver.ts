import { FileStateStore } from "./FileStateStore.js"
import { GuardWhatsAppLinkService } from "./GuardWhatsAppLinkService.js"
import type { WhatsAppLinkResolver } from "@valuya/whatsapp-channel-access"

export class GuardWhatsAppChannelLinkResolver implements WhatsAppLinkResolver {
  private readonly service: GuardWhatsAppLinkService

  constructor(args: {
    baseUrl: string
    tenantToken: string
    channelAppId: string
    stateFile: string
    redeemedFrom?: string
    requestTimeoutMs?: number
  }) {
    const stateStore = new FileStateStore(args.stateFile)
    this.service = new GuardWhatsAppLinkService({
      baseUrl: args.baseUrl,
      tenantToken: args.tenantToken,
      channelAppId: args.channelAppId,
      stateStore,
      redeemedFrom: args.redeemedFrom || "whatsapp_bot_channel",
      requestTimeoutMs: args.requestTimeoutMs,
    })
  }

  async ensureLinkedForPaymentAction(args: {
    whatsappUserId: string
    whatsappProfileName?: string
  }) {
    return this.service.ensureLinkedForPaymentAction(args)
  }

  async redeemLinkToken(args: {
    whatsappUserId: string
    linkToken: string
    whatsappProfileName?: string
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
        "Dein Zugang fuer diesen WhatsApp-Channel ist jetzt aktiv.",
        "Schreib mir einfach ganz normal. Wenn der Channel agent-moderiert ist, antworte ich dir direkt hier.",
      ].join("\n"),
    }
  }
}
