import { FileStateStore } from "../../../whatsapp-bot/dist/whatsapp-bot/src/stateStore.js"
import { GuardWhatsAppLinkService } from "../../../whatsapp-bot/dist/whatsapp-bot/src/channelLinking.js"
import type { LinkResolver } from "../ports/LinkResolver.js"

export class GuardWhatsAppLinkResolverAdapter implements LinkResolver {
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
      redeemedFrom: args.redeemedFrom,
      requestTimeoutMs: args.requestTimeoutMs,
    })
  }

  async ensureLinked(args: { whatsappUserId: string; profileName?: string }) {
    const result = await this.service.ensureLinkedForPaymentAction({
      whatsappUserId: args.whatsappUserId,
      whatsappProfileName: args.profileName,
    })
    if (!result.allowed) {
      return {
        allowed: false as const,
        code: result.code,
        reply: result.reply,
      }
    }

    return {
      allowed: true as const,
      subject: {
        protocolSubjectHeader: String(result.subject.protocolSubjectHeader || "").trim(),
        subjectType: result.subject.type,
        subjectId: result.subject.externalId,
        guardSubjectId: result.subject.guardSubjectId,
        guardSubjectType: result.subject.guardSubjectType,
        guardSubjectExternalId: result.subject.guardSubjectExternalId,
        linkedWalletAddress: result.subject.linkedWalletAddress,
      },
    }
  }

  async redeemLinkToken(args: {
    whatsappUserId: string
    linkToken: string
    profileName?: string
  }): Promise<{
    linked: boolean
    reply: string
    code?: string
  }> {
    const result = await this.service.redeemLinkToken({
      whatsappUserId: args.whatsappUserId,
      linkToken: args.linkToken,
      whatsappProfileName: args.profileName,
    })

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
        "Ich bin jetzt dein Alfies Concierge auf WhatsApp.",
        "Schreib einfach ganz normal, worauf du Lust hast, und ich stelle dir den Einkauf zusammen.",
        "",
        "So klappt es am besten:",
        "- Sag direkt, was du suchst, zum Beispiel ein Gericht, eine Kategorie oder ein Produkt.",
        "- Nenne wichtige Details gleich mit, zum Beispiel 'fuer 4', 'vegetarisch', 'ohne Alkohol' oder 'guenstig'.",
        "- Wenn ich dir eine Liste schicke, antworte einfach mit einer Zahl, 'mehr' oder 'zeige alle'.",
        "- Wenn mein Vorschlag passt, schreib 'alles'. Fuer Zahlung und Stand kannst du 'checkout' und 'status' schreiben.",
        "",
        "Zum Beispiel:",
        "- 'Ich moechte Paella machen heute'",
        "- 'Ich brauche Getraenke fuer heute abend'",
        "- 'Pack Bio-Milch dazu'",
        "- 'Zeig mir Snacks'",
      ].join("\n"),
    }
  }
}
