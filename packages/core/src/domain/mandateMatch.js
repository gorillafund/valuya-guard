import { canonicalizeWalletAddress } from "../canon/subject.js";
export function entitlementFromRequired(required) {
    switch (required.type) {
        case "subscription":
            return { type: "subscription", plan: required.plan };
        case "seat_subscription":
            return { type: "seat_subscription", plan: required.plan };
        case "trial":
            return { type: "trial", plan: required.plan, duration: required.duration };
        case "one_time":
            return {
                type: "one_time",
                sku: required.sku,
                access_duration: required.access_duration,
            };
        case "time_pass":
            return { type: "time_pass", duration: required.duration };
        case "per_call":
            return { type: "per_call", unit: required.unit };
        case "usage_cap":
            return { type: "usage_cap", unit: required.unit, window: required.window };
        case "prepaid_credits":
            return { type: "prepaid_credits", credit_unit: required.credit_unit };
        case "bundle":
            return {
                type: "bundle",
                unit: required.unit,
                quantity: required.quantity,
            };
        case "metered_tiered":
            return {
                type: "metered_tiered",
                unit: required.unit,
                window: required.window,
            };
        case "deposit":
            return { type: "deposit", refundable: required.refundable };
        case "revenue_share":
            return { type: "revenue_share" };
        default: {
            const _x = required;
            return _x;
        }
    }
}
export function isMandateActive(m, nowMs) {
    if (typeof m.valid_from === "number" && nowMs < m.valid_from)
        return false;
    if (typeof m.expires_at === "number" && nowMs >= m.expires_at)
        return false;
    return true;
}
function entitlementMatches(m, r) {
    if (m.type !== r.type)
        return false;
    switch (m.type) {
        case "subscription":
        case "seat_subscription":
            return m.plan === r.plan;
        case "trial":
            return m.plan === r.plan && m.duration === r.duration;
        case "time_pass":
            return m.duration === r.duration;
        case "usage_cap":
        case "metered_tiered":
            return m.unit === r.unit && m.window === r.window;
        case "prepaid_credits":
            return m.credit_unit === r.credit_unit;
        case "bundle":
            return m.unit === r.unit && m.quantity === r.quantity;
        case "one_time":
            return ((m.sku ?? null) === (r.sku ?? null) &&
                (m.access_duration ?? null) === (r.access_duration ?? null));
        case "per_call":
            return (m.unit ?? null) === (r.unit ?? null);
        case "deposit":
            return m.refundable === r.refundable;
        case "revenue_share":
            return true;
    }
}
export function mandateMatches(m, args) {
    const { subject, anchor_resource, required, nowMs, walletAddress } = args;
    if (!isMandateActive(m, nowMs))
        return false;
    if (m.resource !== anchor_resource)
        return false;
    if (m.subject.type !== subject.type)
        return false;
    if (m.subject.id !== subject.id)
        return false;
    if (!entitlementMatches(m.entitlement, entitlementFromRequired(required)))
        return false;
    const allow = m.conditions?.wallet_allowlist;
    if (allow && allow.length > 0) {
        if (!walletAddress)
            return false;
        const w = canonicalizeWalletAddress(walletAddress);
        const normalized = allow.map(canonicalizeWalletAddress);
        if (!normalized.includes(w))
            return false;
    }
    return true;
}
export function findValidMandate(mandates, args) {
    let best = null;
    for (const m of mandates) {
        if (!mandateMatches(m, args))
            continue;
        if (!best || (m.created_at ?? 0) > (best.created_at ?? 0))
            best = m;
    }
    return best;
}
