import type {
  AgentToolDefinition,
  AgentTurnResult,
  ConversationSession,
  LinkedSubject,
} from "../domain/types.js"

export type AgentRuntime = {
  runTurn(args: {
    linkedSubject: LinkedSubject
    session: ConversationSession
    tools: AgentToolDefinition[]
  }): Promise<AgentTurnResult>
}
