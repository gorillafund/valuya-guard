# Monorepo Capabilities

This document summarizes what the monorepo can do today and which package covers each use case.

## Canonical Runtime Behavior

All first-class adapters follow this contract:

- allow: pass request to upstream handler
- deny + HTML: `302` redirect to `payment_url`
- deny + API: `402` JSON with `error=payment_required`, `session_id`, `payment_url`

Contract source:

- [docs/protocol/canonical.md](protocol/canonical.md)
- [openapi/v2.yaml](../openapi/v2.yaml)

## Coverage Matrix

| Capability | Package(s) | Status |
|---|---|---|
| Express middleware | `@valuya/node-express` | Supported |
| Koa middleware | `@valuya/node-koa` | Supported |
| Next.js route protection | `@valuya/nextjs` | Supported |
| NestJS middleware | `@valuya/nestjs` | Supported |
| Hono middleware | `@valuya/hono` | Supported |
| Cloudflare Workers | `@valuya/cloudflare-workers` | Supported |
| Vercel Edge | `@valuya/vercel-edge` | Supported |
| Fastly Compute | `@valuya/fastly-compute` | Supported |
| Browser-side 402 handling | `@valuya/client-js` | Supported |
| AWS Lambda (Node) | `@valuya/aws-lambda-node` | Supported |
| AWS Lambda (Python) | `valuya-guard` | Supported |
| FastAPI middleware | `valuya-fastapi` | Supported |
| Django middleware | `valuya-django` | Supported |
| Laravel middleware | `valuya/guard-laravel` | Supported |
| Rails Rack + helper | `valuya-guard-rails` | Supported |
| Spring Boot starter | `valuya-guard-spring-boot-starter` | Supported |
| Go net/http middleware | `github.com/valuya/go-guard` | Supported |
| Go alt middleware package | `github.com/valuya/go-middleware` | Legacy |
| Nginx auth_request templates | `@valuya/nginx-auth-request`, `@valuya/reverse-proxy` | Supported |
| Traefik forward-auth templates | `@valuya/reverse-proxy` | Supported |
| Caddy forward-auth template | `@valuya/reverse-proxy` | Supported |
| Drop-in auth gateway container | `docker/gateway` | Supported |
| Telegram payment-gated bots | `@valuya/telegram-bot` | Supported |
| Discord payment-gated bots | `@valuya/discord-bot` | Supported |
| Agent wallet bridge (Guardian) | `@valuya/agentokratia-signer` | Supported |

## Product Surface Areas

### Website paywall

Use framework middleware and rely on HTML redirect behavior.

### API monetization

Use server middleware and return canonical `402 payment_required` JSON.

### Agent pay-per-call

Use `@valuya/agent` and `@valuya/agentokratia-signer` for resolve -> buy -> verify -> invoke.

### Reverse proxy drop-in

Use `docker/gateway` + Nginx/Traefik/Caddy templates to protect existing apps with no app-code changes.

## Recommended Defaults

- Resource key per protected feature (deterministic).
- Canonical subject header: `X-Valuya-Subject-Id: <type>:<id>`.
- Fail closed on guard transport or backend errors.
- Prefer `VALUYA_TENANT_TOKEN`; keep `VALUYA_SITE_TOKEN` only for compatibility.
