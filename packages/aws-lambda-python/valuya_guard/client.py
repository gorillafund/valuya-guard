import os
import requests
from .errors import ValuyaConfigError, ValuyaHttpError
from .types import Entitlements, Subject

def _base() -> str:
    b = (os.getenv("VALUYA_BASE") or "").strip().rstrip("/")
    if not b:
        raise ValuyaConfigError("Missing VALUYA_BASE")
    return b

def _site_token() -> str:
    return (os.getenv("VALUYA_SITE_TOKEN") or "").strip()

def entitlements(plan: str, resource: str, subject: Subject) -> Entitlements:
    url = f"{_base()}/api/v2/entitlements"
    headers = {
        "accept": "application/json",
        "x-valuya-subject-type": subject.type,
        "x-valuya-subject-id": subject.id,
    }
    tok = _site_token()
    if tok:
        headers["authorization"] = f"Bearer {tok}"

    r = requests.get(url, params={"plan": plan, "resource": resource}, headers=headers, timeout=10)
    if r.status_code >= 400:
        raise ValuyaHttpError(r.status_code, r.text[:300])

    j = r.json() if r.text else {}
    return Entitlements(
        active=bool(j.get("active")),
        reason=str(j.get("reason") or ""),
        required=j.get("required"),
        expires_at=j.get("expires_at"),
    )

def checkout_session(plan: str, resource: str, subject: Subject, required: dict, success_url: str = "", cancel_url: str = "") -> dict:
    url = f"{_base()}/api/v2/checkout/sessions"
    headers = {
        "accept": "application/json",
        "content-type": "application/json",
        "x-valuya-subject-type": subject.type,
        "x-valuya-subject-id": subject.id,
    }
    tok = _site_token()
    if tok:
        headers["authorization"] = f"Bearer {tok}"

    body = {
        "plan": plan,
        "resource": resource,
        "subject": {"type": subject.type, "id": subject.id},
        "required": required,
        "success_url": success_url,
        "cancel_url": cancel_url,
    }

    r = requests.post(url, json=body, headers=headers, timeout=10)
    if r.status_code >= 400:
        raise ValuyaHttpError(r.status_code, r.text[:300])

    j = r.json() if r.text else {}
    if not j.get("payment_url") or not j.get("session_id"):
        raise ValueError("checkout_session_missing_fields")
    return j
