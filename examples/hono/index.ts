import { Hono } from "hono"
import { valuyaHono } from "@valuya/hono"

const app = new Hono()
app.use("/premium/*", valuyaHono({
  base: process.env.VALUYA_BASE,
  tenantToken: process.env.VALUYA_TENANT_TOKEN,
  plan: "pro",
}))

app.get("/premium/data", (c) => c.json({ ok: true }))

export default app
