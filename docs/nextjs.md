# Next.js Adapter

Use `withValuyaNextRoute()` to protect App Router route handlers.

```ts
export const GET = withValuyaNextRoute({ plan: "pro" }, async () => Response.json({ ok: true }))
```
