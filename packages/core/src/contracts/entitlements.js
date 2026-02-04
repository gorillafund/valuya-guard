"use strict";
// packages/core/src/entitlements.ts
Object.defineProperty(exports, "__esModule", { value: true });
exports.evaluateEntitlement = evaluateEntitlement;
exports.entitlementFromRequired = entitlementFromRequired;
var mandates_ts_1 = require("./mandates.ts");
function evaluateEntitlement(args) {
    var subject = args.subject, resource = args.resource, required = args.required, evaluatedPlan = args.evaluatedPlan, mandates = args.mandates, nowMs = args.nowMs, walletAddress = args.walletAddress;
    if (!subject) {
        return {
            active: false,
            reason: "subject_missing",
            required: required,
            evaluated_plan: evaluatedPlan,
            resource: resource,
            subject: null,
        };
    }
    var mandate = (0, mandates_ts_1.findValidMandate)(mandates, {
        subject: subject,
        resource: resource,
        required: required,
        evaluatedPlan: evaluatedPlan,
        nowMs: nowMs,
        walletAddress: walletAddress,
    });
    if (!mandate) {
        return {
            active: false,
            reason: "subscription_inactive",
            required: required,
            evaluated_plan: evaluatedPlan,
            resource: resource,
            subject: subject,
        };
    }
    // Optional, deterministic enrichment:
    var expires_at = typeof mandate.expires_at === "number"
        ? new Date(mandate.expires_at).toISOString()
        : undefined;
    return {
        active: true,
        evaluated_plan: evaluatedPlan,
        expires_at: expires_at,
        mandate_id: mandate.id,
    };
}
function entitlementFromRequired(required) {
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
            // Exhaustiveness guard
            var _exhaustive = required;
            return _exhaustive;
        }
    }
}
