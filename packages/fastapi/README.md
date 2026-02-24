# valuya-fastapi

FastAPI middleware for Valuya Guard payment-aware authorization.

```py
from fastapi import FastAPI
from valuya_fastapi import ValuyaGuardMiddleware

app = FastAPI()
app.add_middleware(ValuyaGuardMiddleware, plan="pro")
```
