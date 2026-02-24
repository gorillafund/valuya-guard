# @valuya/vercel-edge

Valuya Guard adapter for Vercel Edge runtime.

```ts
import { withValuyaEdge } from "@valuya/vercel-edge"

export default withValuyaEdge(
  { base: process.env.VALUYA_BASE!, tenantToken: process.env.VALUYA_TENANT_TOKEN!, plan: "pro" },
  async () => new Response(JSON.stringify({ ok: true }), { headers: { "content-type": "application/json" } }),
)
```
