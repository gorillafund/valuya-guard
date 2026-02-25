# Valuya Guard Monorepo

Valuya Guard provides payment-aware authorization for apps, APIs, agents, bots, and reverse proxies.

A protected integration always follows the same baseline behavior:

1. `GET /api/v2/entitlements` for subject/resource/plan
2. If active => allow
3. If inactive => `POST /api/v2/checkout/sessions`
4. Web clients => `302` redirect to `payment_url`
5. API clients => `402 payment_required` JSON with `payment_url` + `session_id`

## Start Here

- Fast start: [docs/quickstart.md](docs/quickstart.md)
- Docs index: [docs/README.md](docs/README.md)
- Choose your path: [docs/choose-your-path.md](docs/choose-your-path.md)
- Monorepo capability matrix: [docs/capabilities.md](docs/capabilities.md)
- Which package to install: [docs/which-package.md](docs/which-package.md)
- Supported vs legacy adapters: [docs/supported-vs-legacy.md](docs/supported-vs-legacy.md)

## Core Protocol

- Canonical contract: [docs/protocol/canonical.md](docs/protocol/canonical.md)
- OpenAPI v2: [openapi/v2.yaml](openapi/v2.yaml)
- Agent protocol RFC: [RFC_AGENT_CLIENT_PROTOCOL_V1.md](RFC_AGENT_CLIENT_PROTOCOL_V1.md)
- Product authoring RFC: [RFC_AGENT_PRODUCT_AUTHORING_API.md](RFC_AGENT_PRODUCT_AUTHORING_API.md)

## Package Groups

### Protocol + SDK

- `@valuya/core`
- `@valuya/agent`
- `@valuya/cli`

### Node / JS runtime adapters

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

### Python adapters

- `valuya-guard` (AWS Lambda Python)
- `valuya-fastapi`
- `valuya-django`

### Bot adapters

- `@valuya/telegram-bot`
- `@valuya/discord-bot`

### Agent wallet bridge

- `@valuya/agentokratia-signer`

### Infrastructure / proxy mode

- `@valuya/nginx-auth-request`
- `@valuya/kubernetes`
- `@valuya/reverse-proxy`
- `docker/gateway` (drop-in auth gateway)

### Ecosystem-native packages (non-npm)

- `valuya/guard-laravel` (Composer package source in `packages/laravel`)
- `valuya-guard-rails` (Gem source in `packages/rails`)
- `valuya-guard-spring-boot-starter` (Maven starter source in `packages/spring-boot-starter`)
- `github.com/valuya/go-guard` (Go module source in `packages/go-guard`)

## Examples

Runnable references are in `examples/`.

Key examples:

- `examples/express-api`
- `examples/nextjs`
- `examples/fastapi`
- `examples/nginx-auth-request`
- `examples/reverse-proxy`
- `examples/traefik`
- `examples/go-nethttp`
- `examples/laravel`
- `examples/rails`
- `examples/spring-boot`
- `examples/telegram-bot-template`
- `examples/discord-bot-template`

## Default Environment Model

Most adapters support:

- `VALUYA_BASE` (required)
- `VALUYA_TENANT_TOKEN` (recommended)
- `VALUYA_SITE_TOKEN` (legacy compatibility)
- `VALUYA_PLAN` (default: `standard`)
- `VALUYA_RESOURCE` (optional explicit override)

## Publishing

- JavaScript packages (npm): `pnpm publish:next`
- JavaScript dry run: `pnpm publish:next:dry`
- Python packages (PyPI): `pnpm publish:python`
- Python dry run: `pnpm publish:python:dry`
