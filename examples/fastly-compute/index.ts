import { withValuyaFastly } from "@valuya/fastly-compute"

export default {
  fetch: withValuyaFastly(
    {
      base: (globalThis as any).VALUYA_BASE,
      tenantToken: (globalThis as any).VALUYA_TENANT_TOKEN,
      plan: "pro",
    },
    async () => new Response(JSON.stringify({ ok: true }), { headers: { "content-type": "application/json" } }),
  ),
}
