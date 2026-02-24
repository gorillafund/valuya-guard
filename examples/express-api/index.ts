import express from "express"
import { valuyaExpress } from "@valuya/node-express"

const app = express()
app.use(valuyaExpress({
  base: process.env.VALUYA_BASE,
  tenantToken: process.env.VALUYA_TENANT_TOKEN,
  plan: "pro",
}))
app.get("/premium", (_req, res) => res.json({ ok: true }))
app.listen(3000)
