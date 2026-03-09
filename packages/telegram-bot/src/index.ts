export type TelegramSubject = { type: string; id: string }
export { TelegramPaidChannelAccessService, buildTelegramChannelResource } from "./paidChannel.js"
export type {
  TelegramPaidChannelAccessConfig,
  TelegramChannelAccessResult,
} from "./paidChannel.js"

export type TelegramUser = {
  id: string | number
  username?: string | null
}

export type TelegramGateOptions = {
  base: string
  tenantToken: string
  defaultPlan?: string
  defaultResource?: string
  subjectType?: string
  successUrl?: string
  cancelUrl?: string
}

export type TelegramGateRequest = {
  user: TelegramUser
  resource?: string
  plan?: string
  required?: { type: string; plan?: string; [k: string]: unknown }
}

export type TelegramAccessDecision =
  | {
      ok: true
      active: true
      subject: TelegramSubject
      resource: string
      plan: string
      entitlements: any
    }
  | {
      ok: true
      active: false
      subject: TelegramSubject
      resource: string
      plan: string
      required: { type: string; plan?: string; [k: string]: unknown }
      sessionId: string
      paymentUrl: string
      payment?: unknown
      entitlements: any
      prompt: {
        text: string
        keyboard: { text: string; url: string }[]
      }
    }

export type TelegramStatusResult = {
  active: boolean
  reason?: string
  entitlements: any
  resource: string
  plan: string
  subject: TelegramSubject
}

export function createTelegramGuard(opts: TelegramGateOptions) {
  const base = normalizeBase(opts.base)
  const tenantToken = String(opts.tenantToken || "").trim()
  const defaultPlan = String(opts.defaultPlan || "pro").trim() || "pro"
  const subjectType = String(opts.subjectType || "telegram").trim() || "telegram"

  if (!base) throw new Error("telegram_guard_base_required")
  if (!tenantToken) throw new Error("telegram_guard_tenant_token_required")

  return {
    async gate(input: TelegramGateRequest): Promise<TelegramAccessDecision> {
      const subject = toSubject(input.user, subjectType)
      const resource = (input.resource || opts.defaultResource || "").trim()
      if (!resource) throw new Error("telegram_guard_resource_required")

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
        throw new Error("telegram_guard_checkout_invalid_response")
      }

      const prompt = buildTelegramPaymentPrompt({
        paymentUrl,
        sessionId,
        resource,
        plan,
      })

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
        prompt,
      }
    },

    async status(input: TelegramGateRequest): Promise<TelegramStatusResult> {
      const subject = toSubject(input.user, subjectType)
      const resource = (input.resource || opts.defaultResource || "").trim()
      if (!resource) throw new Error("telegram_guard_resource_required")

      const plan = (input.plan || defaultPlan).trim() || defaultPlan
      const ent = await fetchEntitlements({ base, tenantToken, subject, resource, plan })

      return {
        active: ent?.active === true,
        reason: ent?.reason,
        entitlements: ent,
        resource,
        plan,
        subject,
      }
    },
  }
}

export function buildTelegramPaymentPrompt(args: {
  paymentUrl: string
  sessionId: string
  resource: string
  plan: string
}) {
  const text = [
    "Access to this bot feature requires payment.",
    "",
    `Plan: ${args.plan}`,
    `Session: ${args.sessionId}`,
    "",
    "1) Tap Pay Now",
    "2) Complete payment",
    "3) Return and run /status (or retry your command)",
  ].join("\n")

  return {
    text,
    keyboard: [{ text: "Pay Now", url: args.paymentUrl }],
  }
}

function toSubject(user: TelegramUser, subjectType: string): TelegramSubject {
  const id = String(user.id || "").trim()
  if (!id) throw new Error("telegram_user_id_required")
  return { type: subjectType, id }
}

async function fetchEntitlements(args: {
  base: string
  tenantToken: string
  subject: TelegramSubject
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
  if (!r.ok) throw new Error(`telegram_guard_entitlements_failed:${r.status}:${t.slice(0, 300)}`)
  return t ? JSON.parse(t) : {}
}

async function createCheckoutSession(args: {
  base: string
  tenantToken: string
  subject: TelegramSubject
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
  if (!r.ok) throw new Error(`telegram_guard_checkout_failed:${r.status}:${t.slice(0, 300)}`)
  return t ? JSON.parse(t) : {}
}

function normalizeBase(base: string): string {
  return String(base || "").trim().replace(/\/+$/, "")
}
