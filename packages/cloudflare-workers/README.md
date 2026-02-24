# @valuya/cloudflare-workers

Valuya Guard adapter for Cloudflare Workers fetch handlers.

```ts
import { withValuyaWorker } from "@valuya/cloudflare-workers"

export default {
  fetch: withValuyaWorker({ base: "https://pay.gorilla.build", tenantToken: "...", plan: "pro" }, async () => {
    return new Response(JSON.stringify({ ok: true }), { headers: { "content-type": "application/json" } })
  }),
}
```
