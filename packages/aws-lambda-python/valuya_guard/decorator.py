import os
from functools import wraps
from .subject import default_subject
from .client import entitlements, checkout_session

def valuya_protect(resource: str, plan: str | None = None, success_url: str = "", cancel_url: str = ""):
    evaluated_plan = (plan or os.getenv("DEFAULT_PLAN") or "pro").strip() or "pro"

    def deco(fn):
        @wraps(fn)
        def wrapper(event, context):
            subject = default_subject(event or {})
            ent = entitlements(evaluated_plan, resource, subject)

            if ent.active:
                res = fn(event, context)
                # ensure typical lambda proxy response
                if isinstance(res, dict) and "statusCode" in res:
                    return res
                return {"statusCode": 200, "headers": {"content-type": "application/json"}, "body": str(res)}

            required = ent.required or {"type": "subscription", "plan": evaluated_plan}
            sess = checkout_session(evaluated_plan, resource, subject, required, success_url, cancel_url)

            return {
                "statusCode": 402,
                "headers": {
                    "content-type": "application/json; charset=utf-8",
                    "cache-control": "no-store",
                    "x-valuya-payment-url": sess["payment_url"],
                    "x-valuya-session-id": sess["session_id"],
                },
                "body": __json({
                    "error": "payment_required",
                    "reason": ent.reason or "subscription_inactive",
                    "required": required,
                    "evaluated_plan": evaluated_plan,
                    "resource": resource,
                    "payment_url": sess["payment_url"],
                    "session_id": sess["session_id"],
                }),
            }

        return wrapper
    return deco

def __json(obj) -> str:
    import json
    return json.dumps(obj, ensure_ascii=False)
