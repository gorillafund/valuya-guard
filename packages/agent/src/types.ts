// packages/agent/src/types.ts

export type AgentConfig = {
  base: string // e.g. https://guard.example.com
  tenant_token: string
}

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE"

export type AgentSubject = { type: string; id: string }

export type AgentError = {
  error: string
  message?: string
  status?: number
  body?: any
}
