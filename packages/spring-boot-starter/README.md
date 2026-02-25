# valuya-guard-spring-boot-starter

Spring Boot starter for Valuya Guard payment-aware authorization.

## application.yml

```yaml
valuya:
  base: https://pay.gorilla.build
  tenant-token: ttok_...
  default-plan: standard
  web-redirect: true
```

Behavior:
- entitlement active => request passes through
- entitlement inactive:
  - web/html => 302 redirect to payment_url
  - api/json => 402 payment_required JSON
