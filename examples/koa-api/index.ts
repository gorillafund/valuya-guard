import Koa from "koa"
import { valuyaKoa } from "@valuya/node-koa"

const app = new Koa()
app.use(valuyaKoa({
  base: process.env.VALUYA_BASE,
  tenantToken: process.env.VALUYA_TENANT_TOKEN,
  plan: "pro",
}))
app.use(async (ctx) => { ctx.body = { ok: true } })
app.listen(3001)
