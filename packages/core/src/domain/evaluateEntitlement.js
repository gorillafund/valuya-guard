import { findValidMandate } from "./mandateMatch.js";
export function evaluateEntitlement(args) {
    const { subject, anchor_resource, required, evaluated_plan, mandates, nowMs, walletAddress, } = args;
    if (!subject) {
        return {
            active: false,
            reason: "subject_missing",
            required,
            evaluated_plan,
            anchor_resource,
            subject: null,
        };
    }
    const m = findValidMandate(mandates, {
        subject,
        anchor_resource,
        required,
        nowMs,
        walletAddress,
    });
    if (!m) {
        return {
            active: false,
            reason: "subscription_inactive",
            required,
            evaluated_plan,
            anchor_resource,
            subject,
        };
    }
    const expires_at = typeof m.expires_at === "number"
        ? new Date(m.expires_at).toISOString()
        : undefined;
    return { active: true, evaluated_plan, expires_at, mandate_id: m.id };
}
