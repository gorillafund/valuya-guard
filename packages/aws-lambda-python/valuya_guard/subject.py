import hashlib
from .types import Subject

def default_subject(event: dict) -> Subject:
    # try authorizer-style identity first
    rc = (event or {}).get("requestContext") or {}
    auth = rc.get("authorizer") or {}
    user_id = None

    # common shapes
    user_id = user_id or (auth.get("lambda") or {}).get("user_id")
    user_id = user_id or ((auth.get("jwt") or {}).get("claims") or {}).get("sub")
    user_id = user_id or auth.get("principalId")

    if user_id:
        return Subject(type="user", id=str(user_id))

    headers = normalize_headers((event or {}).get("headers") or {})
    anon = headers.get("x-valuya-anon-id")
    if anon:
        return Subject(type="anon", id=str(anon))

    ip = (rc.get("http") or {}).get("sourceIp") or (rc.get("identity") or {}).get("sourceIp") or ""
    ua = headers.get("user-agent") or ""
    base = f"{ip}|{ua}".strip()

    if base:
        h = hashlib.sha256(base.encode("utf-8")).hexdigest()[:32]
        return Subject(type="anon", id=f"anon_{h}")

    return Subject(type="anon", id="anon_ephemeral")
    
def normalize_headers(h: dict) -> dict:
    return {str(k).lower(): str(v) for k, v in (h or {}).items()}
