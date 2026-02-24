import json
import requests
from django.conf import settings
from django.http import JsonResponse, HttpResponseRedirect


class ValuyaGuardMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response
        self.base = str(getattr(settings, "VALUYA_BASE", "")).strip().rstrip("/")
        self.tenant_token = str(
            getattr(settings, "VALUYA_TENANT_TOKEN", "")
            or getattr(settings, "VALUYA_SITE_TOKEN", "")
        ).strip()
        self.plan = str(getattr(settings, "VALUYA_PLAN", "pro")).strip() or "pro"
        self.resource_override = str(getattr(settings, "VALUYA_RESOURCE", "")).strip()

    def __call__(self, request):
        subject = self._subject(request)
        resource = self.resource_override or f"http:route:{request.method.upper()}:{request.path}"

        ent = self._entitlements(resource, subject)
        if bool(ent.get("active")):
            return self.get_response(request)

        required = ent.get("required") or {"type": "subscription", "plan": self.plan}
        evaluated_plan = ent.get("evaluated_plan") or self.plan
        session = self._checkout_session(resource, subject, required, evaluated_plan)

        accept = request.headers.get("Accept", "")
        if "text/html" in accept and session.get("payment_url"):
            response = HttpResponseRedirect(session["payment_url"])
            response["X-Valuya-Session-Id"] = session["session_id"]
            return response

        body = {
            "error": "payment_required",
            "reason": ent.get("reason") or "payment_required",
            "required": required,
            "evaluated_plan": evaluated_plan,
            "resource": resource,
            "session_id": session["session_id"],
            "payment_url": session.get("payment_url", ""),
        }
        headers = {
            "Cache-Control": "no-store",
            "X-Valuya-Payment-Url": session.get("payment_url", ""),
            "X-Valuya-Session-Id": session["session_id"],
            "Access-Control-Expose-Headers": "X-Valuya-Payment-Url, X-Valuya-Session-Id",
        }
        return JsonResponse(body, status=402, headers=headers)

    def _subject(self, request) -> dict:
        explicit = request.headers.get("x-valuya-subject-id", "")
        if ":" in explicit:
            t, i = explicit.split(":", 1)
            return {"type": t, "id": i}

        anon = request.headers.get("x-valuya-anon-id")
        if anon:
            return {"type": "anon", "id": anon}

        return {"type": "anon", "id": "unknown"}

    def _headers(self, subject: dict) -> dict:
        h = {
            "accept": "application/json",
            "x-valuya-subject-id": f"{subject['type']}:{subject['id']}",
            "x-valuya-subject-type": subject["type"],
            "x-valuya-subject-id-raw": subject["id"],
        }
        if self.tenant_token:
            h["authorization"] = f"Bearer {self.tenant_token}"
        return h

    def _entitlements(self, resource: str, subject: dict) -> dict:
        url = f"{self.base}/api/v2/entitlements"
        r = requests.get(
            url,
            params={"plan": self.plan, "resource": resource},
            headers=self._headers(subject),
            timeout=10,
        )
        if r.status_code >= 400:
            raise RuntimeError(f"valuya_entitlements_failed:{r.status_code}:{r.text[:300]}")
        return r.json() if r.text else {}

    def _checkout_session(self, resource: str, subject: dict, required: dict, plan: str) -> dict:
        url = f"{self.base}/api/v2/checkout/sessions"
        headers = self._headers(subject)
        headers["content-type"] = "application/json"
        payload = {
            "plan": plan,
            "evaluated_plan": plan,
            "resource": resource,
            "subject": subject,
            "required": required,
            "currency": "EUR",
            "amount_cents": 1,
            "success_url": "",
            "cancel_url": "",
        }
        r = requests.post(url, headers=headers, data=json.dumps(payload), timeout=10)
        if r.status_code >= 400:
            raise RuntimeError(f"valuya_checkout_failed:{r.status_code}:{r.text[:300]}")
        j = r.json() if r.text else {}
        if not j.get("session_id"):
            raise RuntimeError("valuya_checkout_invalid_response")
        return j
