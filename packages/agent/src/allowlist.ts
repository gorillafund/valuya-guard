import type { AgentConfig } from "./types.js"

function normalizeBase(base: string): string {
  return base.replace(/\/+$/, "")
}

function headers(cfg: AgentConfig): Record<string, string> {
  return {
    "content-type": "application/json",
    authorization: `Bearer ${cfg.tenant_token}`,
  }
}

export type AllowlistAddRequest = {
  principal_subject_type: string
  principal_subject_id: string
  wallet_address: string
  resource_prefix?: string | null
  plan?: string | null
  max_amount_cents?: number | null
  expires_at?: string | null
  status?: "active" | "disabled"
  meta?: Record<string, any> | null
}

export type AllowlistAddResponse = {
  ok: boolean
  tenant_id?: number
  allowlist_id?: number
  item?: any
  error?: string
}

export async function allowlistAdd(args: {
  cfg: AgentConfig
  body: AllowlistAddRequest
}): Promise<AllowlistAddResponse> {
  const base = normalizeBase(args.cfg.base)
  const url = base + `/api/v2/allowlists/wallets`

  const resp = await fetch(url, {
    method: "POST",
    headers: headers(args.cfg),
    body: JSON.stringify(args.body),
  })

  const txt = await resp.text()
  if (!resp.ok) {
    throw new Error(`allowlistAdd_failed:${resp.status}:${txt.slice(0, 300)}`)
  }
  return JSON.parse(txt)
}
