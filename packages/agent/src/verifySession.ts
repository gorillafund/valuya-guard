import type { AgentConfig } from "./types.js"

function headers(cfg: AgentConfig): Record<string, string> {
  const h: Record<string, string> = {
    Accept: "application/json",
    "Content-Type": "application/json",
  }
  if (cfg.tenanttoken) h.Authorization = `Bearer ${cfg.tenanttoken}`
  return h
}

function normalizeBase(base: string): string {
  return (base || "").trim().replace(/\/+$/, "")
}

export async function verifySession(args: {
  cfg: AgentConfig
  sessionId: string
  from_address: string
}): Promise<any> {
  const base = normalizeBase(args.cfg.base)
  const url =
    base + `/api/v2/agent/sessions/${encodeURIComponent(args.sessionId)}/verify`

  const resp = await fetch(url, {
    method: "POST",
    headers: headers(args.cfg),
    body: JSON.stringify({ from_address: args.from_address }),
  })

  const txt = await resp.text()
  if (!resp.ok)
    throw new Error(`verifySession_failed:${resp.status}:${txt.slice(0, 200)}`)
  return JSON.parse(txt)
}
