import { withValuyaWorker } from "@valuya/cloudflare-workers"

export default {
  fetch: withValuyaWorker(
    {
      base: (globalThis as any).VALUYA_BASE,
      tenantToken: (globalThis as any).VALUYA_TENANT_TOKEN,
      plan: "pro",
    },
    async () => new Response(JSON.stringify({ ok: true }), { headers: { "content-type": "application/json" } }),
  ),
}
