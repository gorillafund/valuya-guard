export type DiscordSubject = { type: string; id: string }

export type DiscordUser = {
  id: string
  username?: string
}

export type DiscordGateOptions = {
  base: string
  tenantToken: string
  defaultPlan?: string
  defaultResource?: string
  subjectType?: string
  successUrl?: string
  cancelUrl?: string
}

export type DiscordGateRequest = {
  user: DiscordUser
  resource?: string
  plan?: string
  required?: { type: string; plan?: string; [k: string]: unknown }
}

export type DiscordGateDecision =
  | {
      ok: true
      active: true
      subject: DiscordSubject
      resource: string
      plan: string
      entitlements: any
    }
  | {
      ok: true
      active: false
      subject: DiscordSubject
      resource: string
      plan: string
      required: { type: string; plan?: string; [k: string]: unknown }
      sessionId: string
      paymentUrl: string
      payment?: unknown
      entitlements: any
      prompt: {
        message: string
        button: { label: string; url: string }
        followupHint: string
      }
    }

export function createDiscordGuard(opts: DiscordGateOptions) {
  const base = normalizeBase(opts.base)
  const tenantToken = String(opts.tenantToken || "").trim()
  const defaultPlan = String(opts.defaultPlan || "pro").trim() || "pro"
  const subjectType = String(opts.subjectType || "discord").trim() || "discord"

  if (!base) throw new Error("discord_guard_base_required")
  if (!tenantToken) throw new Error("discord_guard_tenant_token_required")

  return {
    async gate(input: DiscordGateRequest): Promise<DiscordGateDecision> {
      const subject = toSubject(input.user, subjectType)
      const resource = (input.resource || opts.defaultResource || "").trim()
      if (!resource) throw new Error("discord_guard_resource_required")

      const plan = (input.plan || defaultPlan).trim() || defaultPlan
      const ent = await fetchEntitlements({ base, tenantToken, subject, resource, plan })

      if (ent?.active === true) {
        return {
          ok: true,
          active: true,
          subject,
          resource,
          plan,
          entitlements: ent,
        }
      }

      const required =
        (input.required as any) ||
        (ent?.required as any) ||
        ({ type: "subscription", plan } as const)

      const session = await createCheckoutSession({
        base,
        tenantToken,
        subject,
        resource,
        plan: String((ent as any)?.evaluated_plan || plan),
        required,
        successUrl: opts.successUrl,
        cancelUrl: opts.cancelUrl,
      })

      const paymentUrl = String(session.payment_url || "")
      const sessionId = String(session.session_id || "")
      if (!sessionId || !paymentUrl) {
        throw new Error("discord_guard_checkout_invalid_response")
      }

      return {
        ok: true,
        active: false,
        subject,
        resource,
        plan,
        required,
        sessionId,
        paymentUrl,
        payment: session.payment,
        entitlements: ent,
        prompt: buildDiscordPaymentPrompt({ paymentUrl, sessionId, plan }),
      }
    },

    async status(input: DiscordGateRequest) {
      const subject = toSubject(input.user, subjectType)
      const resource = (input.resource || opts.defaultResource || "").trim()
      if (!resource) throw new Error("discord_guard_resource_required")

      const plan = (input.plan || defaultPlan).trim() || defaultPlan
      const ent = await fetchEntitlements({ base, tenantToken, subject, resource, plan })

      return {
        active: ent?.active === true,
        reason: ent?.reason,
        entitlements: ent,
        subject,
        resource,
        plan,
      }
    },
  }
}

export function buildDiscordPaymentPrompt(args: {
  paymentUrl: string
  sessionId: string
  plan: string
}) {
  return {
    message: `This command is premium. Complete payment to unlock it.\\nPlan: ${args.plan}\\nSession: ${args.sessionId}`,
    button: { label: "Pay Now", url: args.paymentUrl },
    followupHint: "After payment, run /status or retry your premium command.",
  }
}

function toSubject(user: DiscordUser, subjectType: string): DiscordSubject {
  const id = String(user.id || "").trim()
  if (!id) throw new Error("discord_user_id_required")
  return { type: subjectType, id }
}

async function fetchEntitlements(args: {
  base: string
  tenantToken: string
  subject: DiscordSubject
  resource: string
  plan: string
}) {
  const u = new URL(`${args.base}/api/v2/entitlements`)
  u.searchParams.set("plan", args.plan)
  u.searchParams.set("resource", args.resource)

  const headers = new Headers({
    Accept: "application/json",
    Authorization: `Bearer ${args.tenantToken}`,
    "X-Valuya-Subject-Id": `${args.subject.type}:${args.subject.id}`,
    "X-Valuya-Subject-Type": args.subject.type,
    "X-Valuya-Subject-Id-Raw": args.subject.id,
  })

  const r = await fetch(u.toString(), { method: "GET", headers })
  const t = await r.text()
  if (!r.ok) throw new Error(`discord_guard_entitlements_failed:${r.status}:${t.slice(0, 300)}`)
  return t ? JSON.parse(t) : {}
}

async function createCheckoutSession(args: {
  base: string
  tenantToken: string
  subject: DiscordSubject
  resource: string
  plan: string
  required: { type: string; plan?: string; [k: string]: unknown }
  successUrl?: string
  cancelUrl?: string
}) {
  const headers = new Headers({
    Accept: "application/json",
    "Content-Type": "application/json",
    Authorization: `Bearer ${args.tenantToken}`,
    "X-Valuya-Subject-Id": `${args.subject.type}:${args.subject.id}`,
    "X-Valuya-Subject-Type": args.subject.type,
    "X-Valuya-Subject-Id-Raw": args.subject.id,
  })

  const r = await fetch(`${args.base}/api/v2/checkout/sessions`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      plan: args.plan,
      evaluated_plan: args.plan,
      resource: args.resource,
      subject: args.subject,
      principal: args.subject,
      required: args.required,
      success_url: args.successUrl || "",
      cancel_url: args.cancelUrl || "",
      mode: "agent",
    }),
  })

  const t = await r.text()
  if (!r.ok) throw new Error(`discord_guard_checkout_failed:${r.status}:${t.slice(0, 300)}`)
  return t ? JSON.parse(t) : {}
}

function normalizeBase(base: string): string {
  return String(base || "").trim().replace(/\/+$/, "")
}
