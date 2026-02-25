# @valuya/node-express

Payment-aware authorization middleware for Express-compatible servers.

## Install

```bash
npm i @valuya/node-express @valuya/core
```

## Usage

```ts
import express from "express"
import { valuyaExpress } from "@valuya/node-express"

const app = express()
app.use(valuyaExpress({ plan: "pro" }))

app.get("/premium", (_req, res) => {
  res.json({ ok: true })
})
```

Behavior:
- entitlement active => request proceeds
- entitlement missing => `402 payment_required` with `payment_url` + `session_id`
- guard backend/network failure => `503` JSON (`valuya_guard_unavailable`) fail-closed
