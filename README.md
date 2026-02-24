# Valuya Guard

Payment-aware authorization adapters for Valuya Guard.

This monorepo provides framework and runtime adapters that enforce:

1. Entitlement check (`/api/v2/entitlements`)
2. Checkout session creation when required (`/api/v2/checkout/sessions`)
3. `402 payment_required` response (or redirect for HTML clients)

## Packages

- `@valuya/core`
- `@valuya/agent`
- `@valuya/cli`
- `@valuya/aws-lambda-node`
- `valuya-guard` (Python, AWS Lambda)
- `valuya-fastapi`
- `@valuya/telegram-bot`
- `@valuya/discord-bot`
- `@valuya/node-express`
- `@valuya/node-koa`
- `@valuya/cloudflare-workers`
- `@valuya/vercel-edge`
- `@valuya/fastly-compute`
- `@valuya/nextjs`
- `@valuya/nestjs`
- `@valuya/hono`
- `@valuya/client-js`
- `github.com/valuya/go-middleware`
- `valuya-django`
- `@valuya/kubernetes`
- `@valuya/nginx-auth-request`

## Adapter docs

- [AWS Lambda (Node)](docs/aws-lambda.md)
- [AWS Lambda (Python)](docs/aws-lambda-python.md)
- [FastAPI](docs/fastapi.md)
- [Telegram Bot](docs/telegram-bot.md)
- [Discord Bot](docs/discord-bot.md)
- [Node Express](docs/node-express.md)
- [Node Koa](docs/node-koa.md)
- [Cloudflare Workers](docs/cloudflare-workers.md)
- [Vercel Edge](docs/vercel-edge.md)
- [Fastly Compute](docs/fastly-compute.md)
- [Next.js](docs/nextjs.md)
- [NestJS](docs/nestjs.md)
- [Hono](docs/hono.md)
- [Client JS](docs/client-js.md)
- [Go Middleware](docs/go-middleware.md)
- [Django](docs/django.md)
- [Kubernetes](docs/kubernetes.md)
- [Nginx auth_request](docs/nginx-auth-request.md)

## Examples

See `examples/` for runnable reference integrations.

## Environment

Most server adapters support:

- `VALUYA_BASE` (required)
- `VALUYA_TENANT_TOKEN` (recommended)
- `VALUYA_SITE_TOKEN` (legacy compatibility)
- `VALUYA_PLAN` (default: `pro`)
- `VALUYA_RESOURCE` (optional override)

## Protocol

- [Agent protocol RFC](RFC_AGENT_CLIENT_PROTOCOL_V1.md)
- [Product authoring RFC](RFC_AGENT_PRODUCT_AUTHORING_API.md)

## Publishing

- JavaScript packages (npm): `pnpm publish:next`
- JavaScript dry run: `pnpm publish:next:dry`
- Python packages (PyPI): `pnpm publish:python`
- Python dry run: `pnpm publish:python:dry`
