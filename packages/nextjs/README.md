# @valuya/nextjs

Payment-aware authorization for Next.js route handlers and edge-compatible handlers.

## Install

```bash
npm i @valuya/nextjs @valuya/core
```

## Usage (App Router route handler)

```ts
import { withValuyaNextRoute } from "@valuya/nextjs"

export const GET = withValuyaNextRoute(
  { plan: "pro" },
  async () => Response.json({ ok: true }),
)
```

Behavior:
- entitlement active => request proceeds
- entitlement missing => `402 payment_required` with `payment_url` + `session_id`
