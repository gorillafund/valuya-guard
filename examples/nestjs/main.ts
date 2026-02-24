import { MiddlewareConsumer, Module, NestModule } from "@nestjs/common"
import { valuyaNest } from "@valuya/nestjs"

@Module({})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(valuyaNest({
      base: process.env.VALUYA_BASE,
      tenantToken: process.env.VALUYA_TENANT_TOKEN,
      plan: "pro",
    })).forRoutes("premium")
  }
}
