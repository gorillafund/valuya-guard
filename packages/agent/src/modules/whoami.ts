import type { AgentConfig } from "../types.js"
import { apiJson } from "../client/http.js"
import { ROUTES } from "../client/routes.js"

export type AgentSubjectRef = { type: string; id: string }

export type AgentWhoamiResponse = {
  ok?: boolean
  agent?: {
    token_id?: string
    wallet_address?: string | null
    scopes?: string[]
  }
  principal?: {
    subject?: AgentSubjectRef | null
  } | null
  tenant?: {
    id?: number | string
    slug?: string | null
  } | null
}

export async function whoami(args: {
  cfg: AgentConfig
}): Promise<AgentWhoamiResponse> {
  return apiJson<AgentWhoamiResponse>({
    cfg: args.cfg,
    method: "GET",
    path: ROUTES.agentWhoami,
  })
}

