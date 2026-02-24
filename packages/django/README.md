# valuya-django

Django middleware for Valuya Guard payment-aware authorization.

## Install

```bash
pip install valuya-django
```

## Usage

Add middleware in `settings.py`:

```py
MIDDLEWARE = [
  # ...
  "valuya_django.ValuyaGuardMiddleware",
]

VALUYA_BASE = "https://pay.gorilla.build"
VALUYA_TENANT_TOKEN = "ttok_..."
VALUYA_PLAN = "pro"
```

Behavior:
- entitlement active => request proceeds
- entitlement missing => HTTP 402 with `payment_url` + `session_id`
