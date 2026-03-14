import type { ConversationSession } from "../domain/types.js"

export type ConversationStore = {
  getOrCreateSession(args: { whatsappUserId: string }): Promise<ConversationSession>
  saveSession(session: ConversationSession): Promise<void>
}
