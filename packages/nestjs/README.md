# @valuya/nestjs

Payment-aware authorization middleware for NestJS (Express/Fastify HTTP adapters via middleware).

## Install

```bash
npm i @valuya/nestjs @valuya/core
```

## Usage

```ts
import { MiddlewareConsumer, Module, NestModule } from "@nestjs/common"
import { valuyaNest } from "@valuya/nestjs"

@Module({})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(valuyaNest({ plan: "pro" }))
      .forRoutes("premium")
  }
}
```

Behavior:
- entitlement active => request proceeds
- entitlement missing => `402 payment_required` with `payment_url` + `session_id`
