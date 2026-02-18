import type { EntitlementsResponse } from "@valuya/core"
import type { AgentConfig } from "./types.js"

function headers(cfg: AgentConfig, subject?: { type: string; id: string }) {
  const h: Record<string, string> = {
    Accept: "application/json",
  }

  // tenant/site token (guard endpoints)
  if (cfg.tenant_token) h.Authorization = `Bearer ${cfg.tenant_token}`

  // canonical subject header (works with your current backend logs)
  if (subject?.type && subject?.id) {
    h["X-Valuya-Subject-Id"] = `${subject.type}:${subject.id}`

    // legacy compat (keep if your SubjectResolver reads these)
    h["X-Valuya-Subject-Type"] = subject.type
    h["X-Valuya-Subject-Id-Raw"] = subject.id
  }

  return h
}

function normalizeBase(base: string): string {
  return (base || "").trim().replace(/\/+$/, "")
}

function safeJson(txt: string): any {
  try {
    return JSON.parse(txt)
  } catch {
    return {}
  }
}

export async function fetchEntitlements(args: {
  cfg: AgentConfig
  plan: string
  resource: string
  subject: { type: string; id: string }
  origin?: string
}): Promise<EntitlementsResponse> {
  const base = normalizeBase(args.cfg.base)
  if (!base) throw new Error("fetchEntitlements: missing cfg.base")

  const u = new URL(base + "/api/v2/entitlements")
  u.searchParams.set("plan", args.plan)
  u.searchParams.set("resource", args.resource)
  if (args.origin) u.searchParams.set("origin", args.origin)

  const resp = await fetch(u.toString(), {
    method: "GET",
    headers: headers(args.cfg, args.subject),
  })

  const txt = await resp.text().catch(() => "")
  if (!resp.ok) {
    throw new Error(
      `fetchEntitlements_failed:${resp.status}:${txt.slice(0, 300)}`,
    )
  }

  return safeJson(txt) as EntitlementsResponse
}
