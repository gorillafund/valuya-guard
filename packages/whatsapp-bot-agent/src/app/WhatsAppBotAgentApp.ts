import type {
  ConversationEntry,
  ConversationSession,
  WhatsAppAgentReply,
  WhatsAppInboundMessage,
} from "../domain/types.js"
import type { AgentRuntime } from "../ports/AgentRuntime.js"
import type { ConversationStore } from "../ports/ConversationStore.js"
import type { LinkResolver } from "../ports/LinkResolver.js"
import type { ToolRegistry } from "../ports/ToolRegistry.js"
import { extractLinkToken } from "../../../whatsapp-bot/dist/whatsapp-bot/src/channelLinking.js"

const MAX_WHATSAPP_REPLY_CHARS = 1500
const TRUNCATION_NOTICE = "Liste gekuerzt, damit die Nachricht in WhatsApp ankommt. Schreib 'mehr' oder nenne direkt eine Zahl."

export class WhatsAppBotAgentApp {
  private readonly maxToolRounds: number

  constructor(private readonly deps: {
    agentRuntime: AgentRuntime
    conversationStore: ConversationStore
    linkResolver: LinkResolver
    toolRegistry: ToolRegistry
    now?: () => Date
    maxToolRounds?: number
  }) {
    this.maxToolRounds = deps.maxToolRounds ?? 4
  }

  async handleInboundMessage(input: WhatsAppInboundMessage): Promise<WhatsAppAgentReply> {
    const linkToken = extractLinkToken(input.body)
    if (linkToken) {
      const linked = await this.deps.linkResolver.redeemLinkToken({
        whatsappUserId: input.whatsappUserId,
        linkToken,
        profileName: input.profileName,
      })
      return {
        reply: linked.reply,
        metadata: {
          ...(linked.code ? { code: linked.code } : {}),
          linkAttempt: true,
          linked: linked.linked,
        },
      }
    }

    const linked = await this.deps.linkResolver.ensureLinked({
      whatsappUserId: input.whatsappUserId,
      profileName: input.profileName,
    })
    if (!linked.allowed) {
      return {
        reply: linked.reply,
        metadata: { code: linked.code, blocked: true },
      }
    }

    const session = await this.deps.conversationStore.getOrCreateSession({
      whatsappUserId: input.whatsappUserId,
    })
    session.entries.push(this.toEntry("user", input.body))

    for (let round = 0; round <= this.maxToolRounds; round++) {
      const turn = await this.deps.agentRuntime.runTurn({
        linkedSubject: linked.subject,
        session,
        tools: this.deps.toolRegistry.listTools(),
      })

      if (turn.toolCalls?.length) {
        for (const call of turn.toolCalls) {
          const result = await this.deps.toolRegistry.executeTool({
            call,
            linkedSubject: linked.subject,
            session,
          })
          session.entries.push(this.toEntry("tool", JSON.stringify(result.output), {
            name: result.name,
            toolCallId: result.toolCallId,
          }))
        }
        continue
      }

      if (turn.reply?.trim()) {
        const reply = clampReplyForWhatsApp(turn.reply)
        session.metadata = {
          ...(session.metadata || {}),
          ...(turn.metadata || {}),
        }
        session.entries.push(this.toEntry("assistant", reply))
        await this.deps.conversationStore.saveSession(session)
        return {
          conversationId: session.conversationId,
          reply,
          linkedSubject: linked.subject,
          metadata: turn.metadata,
        }
      }

      break
    }

    const fallback = "Ich habe gerade keine saubere Antwort erzeugt. Bitte versuche es noch einmal."
    session.entries.push(this.toEntry("assistant", fallback))
    await this.deps.conversationStore.saveSession(session)
    return {
      conversationId: session.conversationId,
      reply: fallback,
      linkedSubject: linked.subject,
      metadata: { degraded: true },
    }
  }

  private toEntry(
    role: ConversationEntry["role"],
    content: string,
    extra?: Pick<ConversationEntry, "name" | "toolCallId">,
  ): ConversationEntry {
    return {
      role,
      content,
      createdAt: (this.deps.now ?? (() => new Date()))().toISOString(),
      ...(extra?.name ? { name: extra.name } : {}),
      ...(extra?.toolCallId ? { toolCallId: extra.toolCallId } : {}),
    }
  }
}

function clampReplyForWhatsApp(reply: string): string {
  const normalized = String(reply || "").replace(/\r\n/g, "\n").trim()
  if (normalized.length <= MAX_WHATSAPP_REPLY_CHARS) return normalized

  const reserve = TRUNCATION_NOTICE.length + 2
  const budget = Math.max(200, MAX_WHATSAPP_REPLY_CHARS - reserve)
  const lines = normalized.split("\n")
  const kept: string[] = []
  let used = 0

  for (const rawLine of lines) {
    const line = rawLine.trimEnd()
    const nextCost = (kept.length ? 1 : 0) + line.length
    if (kept.length && used + nextCost > budget) break
    if (!kept.length && line.length > budget) {
      kept.push(line.slice(0, Math.max(0, budget - 1)).trimEnd() + "…")
      used = kept[0]?.length || 0
      break
    }
    kept.push(line)
    used += nextCost
  }

  return `${kept.join("\n")}\n\n${TRUNCATION_NOTICE}`.trim()
}
