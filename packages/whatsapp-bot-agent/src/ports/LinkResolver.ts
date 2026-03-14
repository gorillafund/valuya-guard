import type { GuardAccessDecision } from "../domain/types.js"

export type LinkResolver = {
  ensureLinked(args: {
    whatsappUserId: string
    profileName?: string
  }): Promise<GuardAccessDecision>
  redeemLinkToken(args: {
    whatsappUserId: string
    linkToken: string
    profileName?: string
  }): Promise<{
    linked: boolean
    reply: string
    code?: string
  }>
}
