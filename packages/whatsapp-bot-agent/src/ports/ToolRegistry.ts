import type {
  AgentToolCall,
  AgentToolDefinition,
  AgentToolResult,
  ConversationSession,
  LinkedSubject,
} from "../domain/types.js"

export type ToolRegistry = {
  listTools(): AgentToolDefinition[]
  executeTool(args: {
    call: AgentToolCall
    linkedSubject: LinkedSubject
    session: ConversationSession
  }): Promise<AgentToolResult>
}
