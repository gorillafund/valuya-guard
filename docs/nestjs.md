# NestJS Adapter

Use `valuyaNest()` as middleware in your Nest module.

```ts
consumer.apply(valuyaNest({ plan: "pro" })).forRoutes("premium")
```
