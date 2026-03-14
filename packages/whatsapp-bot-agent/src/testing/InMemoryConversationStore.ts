import { randomUUID } from "node:crypto"
import type { ConversationSession } from "../domain/types.js"
import type { ConversationStore } from "../ports/ConversationStore.js"

export class InMemoryConversationStore implements ConversationStore {
  private readonly sessionsByUserId = new Map<string, ConversationSession>()

  async getOrCreateSession(args: { whatsappUserId: string }): Promise<ConversationSession> {
    const existing = this.sessionsByUserId.get(args.whatsappUserId)
    if (existing) return cloneSession(existing)

    const created: ConversationSession = {
      conversationId: randomUUID(),
      whatsappUserId: args.whatsappUserId,
      entries: [],
    }
    this.sessionsByUserId.set(args.whatsappUserId, cloneSession(created))
    return created
  }

  async saveSession(session: ConversationSession): Promise<void> {
    this.sessionsByUserId.set(session.whatsappUserId, cloneSession(session))
  }
}

function cloneSession(session: ConversationSession): ConversationSession {
  return {
    ...session,
    metadata: session.metadata ? { ...session.metadata } : undefined,
    entries: session.entries.map((entry) => ({ ...entry })),
  }
}
