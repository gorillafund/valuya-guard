import type { EntitlementsResponse } from "@valuya/core"
import type { CheckoutSessionResponse } from "@valuya/core"
import type { GuardRequired } from "@valuya/core"
import { ValuyaConfigError, ValuyaHttpError } from "./errors.js"

export type GuardClientConfig = {
  base: string
  tenanttoken?: string
}

export async function fetchEntitlements(args: {
  cfg: GuardClientConfig
  plan: string
  resource: string
  subject: { type: string; id: string }
}): Promise<EntitlementsResponse> {
  const { cfg, plan, resource, subject } = args
  const base = normalizeBase(cfg.base)
  if (!base) throw new ValuyaConfigError("Missing VALUYA_BASE")

  const u = new URL(base + "/api/v2/entitlements")
  u.searchParams.set("plan", plan)
  u.searchParams.set("resource", resource)

  const headers: Record<string, string> = {
    Accept: "application/json",

    // Canonical subject header:
    "X-Valuya-Subject-Id": `${subject.type}:${subject.id}`,

    // Legacy compatibility (optional):
    "X-Valuya-Subject-Type": subject.type,
    "X-Valuya-Subject-Id-Raw": subject.id, // avoid collision; keep if your backend expects split headers
  }

  if (cfg.tenanttoken) headers.Authorization = `Bearer ${cfg.tenanttoken}`

  const resp = await fetch(u.toString(), { method: "GET", headers })
  const txt = await resp.text().catch(() => "")
  if (!resp.ok) throw new ValuyaHttpError(resp.status, txt.slice(0, 300))

  return safeJson(txt) as EntitlementsResponse
}

export async function createCheckoutSession(args: {
  cfg: GuardClientConfig
  plan: string
  resource: string
  subject: { type: string; id: string }
  required: GuardRequired
  currency: string
  amountCents: number
  successUrl?: string
  cancelUrl?: string
  idempotencyKey?: string
}): Promise<CheckoutSessionResponse & { payment?: any }> {
  const { cfg, plan, resource, subject, required } = args
  const base = normalizeBase(cfg.base)
  if (!base) throw new ValuyaConfigError("Missing VALUYA_BASE")

  const url = base + "/api/v2/checkout/sessions"

  const body = {
    plan,
    evaluated_plan: plan,
    resource,
    subject,
    required,
    success_url: args.successUrl || "",
    cancel_url: args.cancelUrl || "",
    idempotency_key: args.idempotencyKey || "",
    currency: args.currency,
    amount_cents: args.amountCents,
  }

  const headers: Record<string, string> = {
    Accept: "application/json",
    "Content-Type": "application/json",

    // Canonical subject header:
    "X-Valuya-Subject-Id": `${subject.type}:${subject.id}`,

    // Legacy compatibility (optional):
    "X-Valuya-Subject-Type": subject.type,
    "X-Valuya-Subject-Id-Raw": subject.id,
  }

  if (args.idempotencyKey) headers["Idempotency-Key"] = args.idempotencyKey
  if (cfg.tenanttoken) headers.Authorization = `Bearer ${cfg.tenanttoken}`

  const resp = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  })

  const txt = await resp.text().catch(() => "")
  if (!resp.ok) throw new ValuyaHttpError(resp.status, txt.slice(0, 300))

  const json = safeJson(txt) as any
  if (!json?.session_id) {
    throw new ValuyaHttpError(
      422,
      `Invalid checkout session response: ${JSON.stringify(json)}`,
    )
  }

  return {
    session_id: json.session_id,
    expires_at: json.expires_at,
    payment_url: json.payment_url ?? null,
    payment: json.payment ?? null,
  }
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
