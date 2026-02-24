# @valuya/hono

Payment-aware authorization middleware for Hono.

## Install

```bash
npm i @valuya/hono @valuya/core
```

## Usage

```ts
import { Hono } from "hono"
import { valuyaHono } from "@valuya/hono"

const app = new Hono()
app.use("/premium/*", valuyaHono({ plan: "pro" }))
app.get("/premium/data", (c) => c.json({ ok: true }))
```

Behavior:
- entitlement active => request proceeds
- entitlement missing => `402 payment_required` with `payment_url` + `session_id`
