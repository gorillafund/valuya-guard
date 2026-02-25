# valuya-fastapi

FastAPI middleware for Valuya Guard payment-aware authorization.

```py
from fastapi import FastAPI
from valuya_fastapi import ValuyaGuardMiddleware

app = FastAPI()
app.add_middleware(ValuyaGuardMiddleware, plan="pro")
```

Behavior:
- entitlement active => request proceeds
- entitlement missing => `402 payment_required` JSON (or `302` redirect for HTML requests)
- guard backend/network failure => `503` JSON (`valuya_guard_unavailable`) fail-closed
