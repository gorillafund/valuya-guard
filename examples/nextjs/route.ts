import { withValuyaNextRoute } from "@valuya/nextjs"

export const GET = withValuyaNextRoute(
  {
    base: process.env.VALUYA_BASE,
    tenantToken: process.env.VALUYA_TENANT_TOKEN,
    plan: "pro",
  },
  async () => Response.json({ ok: true }),
)
