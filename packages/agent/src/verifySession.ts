import type { AgentConfig, VerifySessionResponse } from "./types.js"

function headers(cfg: AgentConfig): Record<string, string> {
  const h: Record<string, string> = {
    Accept: "application/json",
    "Content-Type": "application/json",
  }
  if (cfg.tenant_token) h.Authorization = `Bearer ${cfg.tenant_token}`
  return h
}

function normalizeBase(base: string): string {
  return (base || "").trim().replace(/\/+$/, "")
}

export async function verifySession(args: {
  cfg: AgentConfig
  sessionId: string
  wallet_address: string
}): Promise<VerifySessionResponse> {
  const base = normalizeBase(args.cfg.base)
  const url =
    base + `/api/v2/agent/sessions/${encodeURIComponent(args.sessionId)}/verify`

  const resp = await fetch(url, {
    method: "POST",
    headers: headers(args.cfg),
    body: JSON.stringify({ wallet_address: args.wallet_address }),
  })

  const txt = await resp.text()
  if (!resp.ok)
    throw new Error(`verifySession_failed:${resp.status}:${txt.slice(0, 200)}`)

  return JSON.parse(txt) as VerifySessionResponse
}
