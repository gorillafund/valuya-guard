"use strict";
// packages/core/src/mandates.ts
Object.defineProperty(exports, "__esModule", { value: true });
exports.isMandateActive = isMandateActive;
exports.mandateMatches = mandateMatches;
exports.findValidMandate = findValidMandate;
exports.hasValidMandate = hasValidMandate;
var subject_ts_1 = require("../subject.ts");
var entitlements_ts_1 = require("./entitlements.ts");
function isMandateActive(m, nowMs) {
    if (typeof m.valid_from === "number" && nowMs < m.valid_from)
        return false;
    if (typeof m.expires_at === "number" && nowMs >= m.expires_at)
        return false;
    return true;
}
function mandateMatches(m, args) {
    var _a, _b, _c;
    var subject = args.subject, resource = args.resource, required = args.required, evaluatedPlan = args.evaluatedPlan, nowMs = args.nowMs, walletAddress = args.walletAddress;
    if (!isMandateActive(m, nowMs))
        return false;
    // Exact match — deterministic, no wildcards
    if (m.resource !== resource)
        return false;
    if (((_a = m.subject) === null || _a === void 0 ? void 0 : _a.type) !== subject.type)
        return false;
    if (((_b = m.subject) === null || _b === void 0 ? void 0 : _b.id) !== subject.id)
        return false;
    // Plan matching (subscription)
    var requiredEntitlement = (0, entitlements_ts_1.entitlementFromRequired)(required);
    if (!m.entitlement)
        return false; // Option B strict
    if (!entitlementMatches(m.entitlement, requiredEntitlement))
        return false;
    // Wallet allowlist enforcement (agent payments support)
    var allowlist = (_c = m.conditions) === null || _c === void 0 ? void 0 : _c.wallet_allowlist;
    if (allowlist && allowlist.length > 0) {
        if (!walletAddress)
            return false;
        var w = (0, subject_ts_1.canonicalizeWalletAddress)(walletAddress);
        var normalized = allowlist.map(subject_ts_1.canonicalizeWalletAddress);
        if (!normalized.includes(w))
            return false;
    }
    function entitlementMatches(m, r) {
        var _a, _b, _c, _d, _e, _f;
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
                // Choose a deterministic rule:
                // - If sku exists on both, must match
                // - If mandate has sku but required doesn't, allow? I'd say NO to avoid accidental unlocks.
                return (((_a = m.sku) !== null && _a !== void 0 ? _a : null) === ((_b = r.sku) !== null && _b !== void 0 ? _b : null) &&
                    ((_c = m.access_duration) !== null && _c !== void 0 ? _c : null) === ((_d = r.access_duration) !== null && _d !== void 0 ? _d : null));
            case "per_call":
                // unit match if specified (avoid over-constraining)
                return ((_e = m.unit) !== null && _e !== void 0 ? _e : null) === ((_f = r.unit) !== null && _f !== void 0 ? _f : null);
            case "deposit":
                return m.refundable === r.refundable;
            case "revenue_share":
                return true;
        }
    }
    return true;
}
function findValidMandate(mandates, args) {
    var _a, _b;
    // deterministic selection rule:
    // choose the newest valid mandate (highest created_at)
    var best = null;
    for (var _i = 0, mandates_1 = mandates; _i < mandates_1.length; _i++) {
        var m = mandates_1[_i];
        if (!mandateMatches(m, args))
            continue;
        if (!best || ((_a = m.created_at) !== null && _a !== void 0 ? _a : 0) > ((_b = best.created_at) !== null && _b !== void 0 ? _b : 0))
            best = m;
    }
    return best;
}
function hasValidMandate(mandates, args) {
    return !!findValidMandate(mandates, args);
}
