# Quickstart

Goal: first protected route in 10-20 minutes.

## Shared env

```bash
export VALUYA_BASE="https://pay.gorilla.build"
export VALUYA_TENANT_TOKEN="ttok_..."
export VALUYA_PLAN="standard"
```

## 1) Express

Example: `examples/express-api`

```ts
import express from "express"
import { valuyaExpress } from "@valuya/node-express"

const app = express()
app.use(valuyaExpress({ plan: "standard" }))
app.get("/premium", (_req, res) => res.json({ ok: true }))
app.listen(3000)
```

## 2) Next.js route handler

Example: `examples/nextjs`

```ts
import { withValuyaNextRoute } from "@valuya/nextjs"

export const GET = withValuyaNextRoute({ plan: "standard" }, async () => {
  return Response.json({ ok: true })
})
```

## 3) FastAPI

Example: `examples/fastapi`

```py
from fastapi import FastAPI
from valuya_fastapi import ValuyaGuardMiddleware

app = FastAPI()
app.add_middleware(ValuyaGuardMiddleware, plan="standard")
```

## 4) Nginx drop-in (no app code)

Example: `examples/nginx-auth-request` and `docs/reverse-proxy.md`

Use `auth_request` against Valuya guard gateway and keep upstream app unchanged.

## Expected behavior

- If entitlement is active: protected route succeeds.
- If entitlement missing:
  - browser/html request => `302` redirect to `payment_url`
  - api/json request => `402` body with `payment_url` + `session_id`
