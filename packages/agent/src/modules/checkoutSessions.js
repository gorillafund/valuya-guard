import { apiJson } from "../client/http.js";
import { ROUTES } from "../client/routes.js";
export async function createCheckoutSession(args) {
    const subjectId = `${args.subject.type}:${args.subject.id}`;
    return apiJson({
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
    });
}
export async function getCheckoutSession(args) {
    return apiJson({
        cfg: args.cfg,
        method: "GET",
        path: ROUTES.checkoutSessionsShow(args.sessionId),
    });
}
