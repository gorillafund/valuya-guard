// packages/core/src/v2/protocol/responses.ts
export function paymentRequiredResponseV2(args) {
    const bodyObj = {
        error: "payment_required",
        reason: args.reason,
        required: args.required,
        evaluated_plan: args.evaluated_plan,
        resource: args.resource,
        session_id: args.session_id,
        payment_url: args.payment_url,
        ...(args.payment ? { payment: args.payment } : {}),
    };
    const headers = {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
        "Access-Control-Expose-Headers": "X-Valuya-Payment-Url, X-Valuya-Session-Id",
        "X-Valuya-Payment-Url": args.payment_url,
        "X-Valuya-Session-Id": args.session_id,
    };
    return { status: 402, headers, body: JSON.stringify(bodyObj) };
}
