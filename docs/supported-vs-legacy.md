# Supported vs Legacy

## Supported

- `@valuya/core`
- `@valuya/agent`
- `@valuya/cli`
- `@valuya/node-express`
- `@valuya/node-koa`
- `@valuya/nextjs`
- `@valuya/nestjs`
- `@valuya/hono`
- `@valuya/cloudflare-workers`
- `@valuya/vercel-edge`
- `@valuya/fastly-compute`
- `@valuya/client-js`
- `@valuya/aws-lambda-node`
- `valuya-guard` (AWS Lambda Python)
- `valuya-fastapi`
- `valuya-django`
- `valuya/guard-laravel`
- `valuya-guard-rails`
- `valuya-guard-spring-boot-starter`
- `github.com/valuya/go-guard`
- `@valuya/reverse-proxy`
- `@valuya/nginx-auth-request`
- `@valuya/kubernetes`
- `@valuya/telegram-bot`
- `@valuya/discord-bot`
- `@valuya/agentokratia-signer`

## Legacy / Compatibility

- `github.com/valuya/go-middleware` (use `github.com/valuya/go-guard` for new integrations)
- `VALUYA_SITE_TOKEN` env var (use `VALUYA_TENANT_TOKEN` for new integrations)
- Split subject headers (`X-Valuya-Subject-Type`, `X-Valuya-Subject-Id-Raw`) are compatibility-only; canonical is `X-Valuya-Subject-Id`
- Raw `products/prepare` payload shape is compatibility-only; canonical request is `{ "draft": { ... } }`

## Migration notes

- Prefer canonical protocol docs and OpenAPI for all new integrations.
- New adapters should be validated against canonical `allow/deny/checkout` contract tests.
