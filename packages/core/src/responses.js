"use strict";
// packages/core/src/responses.ts
var __assign = (this && this.__assign) || function () {
    __assign = Object.assign || function(t) {
        for (var s, i = 1, n = arguments.length; i < n; i++) {
            s = arguments[i];
            for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p))
                t[p] = s[p];
        }
        return t;
    };
    return __assign.apply(this, arguments);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.paymentRequiredResponse = paymentRequiredResponse;
function paymentRequiredResponse(args) {
    var bodyObj = __assign({ error: "payment_required", reason: args.reason, required: args.required, evaluated_plan: args.evaluatedPlan, resource: args.resource, session_id: args.sessionId, payment_url: args.paymentUrl }, (args.payment ? { payment: args.payment } : {}));
    var headers = {
        // RFC-exact casing:
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
        "Access-Control-Expose-Headers": "X-Valuya-Payment-Url, X-Valuya-Session-Id",
        "X-Valuya-Payment-Url": args.paymentUrl,
        "X-Valuya-Session-Id": args.sessionId,
    };
    return {
        status: 402,
        headers: headers,
        body: JSON.stringify(bodyObj),
    };
}
