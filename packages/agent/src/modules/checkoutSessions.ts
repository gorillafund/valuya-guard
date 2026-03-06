import { apiJson } from "../client/http.js"
import { ROUTES } from "../client/routes.js"
import type { AgentConfig } from "../types.js"
import type {
  AgentCheckoutSessionResponseV2,
  GuardRequired,
} from "@valuya/core"

export async function createCheckoutSession(args: {
  cfg: AgentConfig
  resource: string
  plan: string
  subject: { type: string; id: string }
  principal: { type: string; id: string } // optional, defaults to subject if not provided
  required: GuardRequired
  origin?: string
  quantity_requested?: number
}): Promise<AgentCheckoutSessionResponseV2> {
  const subjectId = `${args.subject.type}:${args.subject.id}`
  return apiJson<AgentCheckoutSessionResponseV2>({
    cfg: args.cfg,
    method: "POST",
    path: ROUTES.checkoutSessionsCreate,
    headers: {
      Accept: "application/json",
      "X-Valuya-Subject-Id": subjectId,
      "X-Valuya-Subject-Type": args.subject.type,
      "X-Valuya-Subject-Id-Raw": args.subject.id,
    },
    body: {
      resource: args.resource,
      plan: args.plan,
      evaluated_plan: args.plan,
      subject: args.subject,
      principal: args.principal ?? args.subject,
      required: args.required,
      ...(args.origin ? { origin: args.origin } : {}),
      ...(typeof args.quantity_requested === "number"
        ? { quantity_requested: args.quantity_requested }
        : {}),
      mode: "agent",
    },
  })
}

export async function getCheckoutSession(args: {
  cfg: AgentConfig
  sessionId: string
}): Promise<AgentCheckoutSessionResponseV2> {
  return apiJson<AgentCheckoutSessionResponseV2>({
    cfg: args.cfg,
    method: "GET",
    path: ROUTES.checkoutSessionsShow(args.sessionId),
  })
}
