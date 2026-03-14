export type WhatsAppInboundMessage = {
  whatsappUserId: string
  body: string
  profileName?: string
}

export type LinkedSubject = {
  protocolSubjectHeader: string
  subjectType?: string
  subjectId?: string
  guardSubjectId?: string
  guardSubjectType?: string
  guardSubjectExternalId?: string
  linkedWalletAddress?: string
}

export type ConversationRole = "user" | "assistant" | "tool"

export type ConversationEntry = {
  role: ConversationRole
  content: string
  name?: string
  toolCallId?: string
  createdAt: string
}

export type ConversationSession = {
  conversationId: string
  whatsappUserId: string
  entries: ConversationEntry[]
  metadata?: Record<string, unknown>
}

export type AgentToolDefinition = {
  name: string
  description: string
}

export type AgentToolCall = {
  id: string
  name: string
  input: Record<string, unknown>
}

export type AgentToolResult = {
  toolCallId: string
  name: string
  output: Record<string, unknown>
}

export type AgentTurnResult = {
  reply?: string
  toolCalls?: AgentToolCall[]
  metadata?: Record<string, unknown>
}

export type GuardAccessDecision =
  | {
      allowed: true
      subject: LinkedSubject
    }
  | {
      allowed: false
      code: string
      reply: string
    }

export type WhatsAppAgentReply = {
  conversationId?: string
  reply: string
  linkedSubject?: LinkedSubject
  metadata?: Record<string, unknown>
}
