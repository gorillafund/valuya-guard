# @valuya/node-koa

Payment-aware authorization middleware for Koa.

```ts
import Koa from "koa"
import { valuyaKoa } from "@valuya/node-koa"

const app = new Koa()
app.use(valuyaKoa({ plan: "pro" }))
```
