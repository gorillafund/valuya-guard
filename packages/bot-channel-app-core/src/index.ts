export type LinkRedeemResult = {
  linked: boolean
  reply: string
  code?: string
}

export type InboundAppResult = {
  reply: string
  metadata?: Record<string, unknown>
}

export class BotChannelApp<TInboundArgs, TChannelArgs, TChannelResult, TLinkArgs> {
  constructor(private readonly deps: {
    channel: {
      handleMessage(args: TChannelArgs): Promise<TChannelResult>
    }
    linkResolver?: {
      redeemLinkToken(args: TLinkArgs): Promise<LinkRedeemResult>
    }
    extractLinkToken?: (args: TInboundArgs) => string | null
    buildLinkArgs?: (args: TInboundArgs, linkToken: string) => TLinkArgs
    buildChannelArgs: (args: TInboundArgs) => TChannelArgs
    getChannelReply: (result: TChannelResult) => string
    getChannelMetadata?: (result: TChannelResult) => Record<string, unknown> | undefined
    getLinkMetadata?: (result: LinkRedeemResult) => Record<string, unknown> | undefined
  }) {}

  async handleInboundMessage(args: TInboundArgs): Promise<InboundAppResult> {
    const linkToken = this.deps.extractLinkToken?.(args)
    if (linkToken && this.deps.linkResolver && this.deps.buildLinkArgs) {
      const result = await this.deps.linkResolver.redeemLinkToken(this.deps.buildLinkArgs(args, linkToken))
      return {
        reply: result.reply,
        metadata: this.deps.getLinkMetadata?.(result),
      }
    }

    const result = await this.deps.channel.handleMessage(this.deps.buildChannelArgs(args))
    return {
      reply: this.deps.getChannelReply(result),
      metadata: this.deps.getChannelMetadata?.(result),
    }
  }
}

export function extractLinkCommandToken(body: string): string | null {
  const value = String(body || "").trim()
  if (!value) return null
  const match = value.match(/(?:^|\s)LINK\s+(gls_[A-Za-z0-9]+)/i)
  return match?.[1] || null
}

export function extractTelegramStartToken(body: string): string | null {
  const value = String(body || "").trim()
  if (!value) return null
  const match = value.match(/^\/start(?:@\w+)?\s+(gls_[A-Za-z0-9]+)/i)
  return match?.[1] || null
}
