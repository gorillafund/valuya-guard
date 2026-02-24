# @valuya/fastly-compute

Valuya Guard adapter for Fastly Compute (fetch-style handlers).

```ts
import { withValuyaFastly } from "@valuya/fastly-compute"

export default {
  fetch: withValuyaFastly(
    { base: "https://pay.gorilla.build", tenantToken: "...", plan: "pro" },
    async () => new Response(JSON.stringify({ ok: true }), { headers: { "content-type": "application/json" } }),
  ),
}
```
