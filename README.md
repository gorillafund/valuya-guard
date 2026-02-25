# Valuya Guard Monorepo

[![CI](https://github.com/gorillafund/valuya-guard/actions/workflows/ci.yml/badge.svg)](https://github.com/gorillafund/valuya-guard/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
[![Latest Release](https://img.shields.io/github/v/release/gorillafund/valuya-guard)](https://github.com/gorillafund/valuya-guard/releases)
[![OpenAPI](https://img.shields.io/badge/OpenAPI-v2-blue)](openapi/v2.yaml)
[![Coverage](https://img.shields.io/badge/coverage-contract%20harness%20enabled-brightgreen)](tests/contract)

Payment-aware authorization middleware, SDKs, adapters, and reverse-proxy gateway for Valuya Guard.

## Why Valuya Guard

Valuya Guard standardizes monetized access control across web apps, APIs, bots, agents, and gateways with a deterministic, fail-closed contract.

Canonical flow:

1. `GET /api/v2/entitlements`
2. active => allow
3. inactive => `POST /api/v2/checkout/sessions`
4. HTML => `302` redirect to `payment_url`
5. API => `402 payment_required` JSON

## Start Here

- Quickstart: [docs/quickstart.md](docs/quickstart.md)
- Docs index: [docs/README.md](docs/README.md)
- Choose your path: [docs/choose-your-path.md](docs/choose-your-path.md)
- Capability matrix: [docs/capabilities.md](docs/capabilities.md)
- Adapter consistency matrix: [docs/adapter-consistency-matrix.md](docs/adapter-consistency-matrix.md)
- Which package should I use: [docs/which-package.md](docs/which-package.md)
- Supported vs legacy: [docs/supported-vs-legacy.md](docs/supported-vs-legacy.md)

## Protocol & Stability

- Canonical contract: [docs/protocol/canonical.md](docs/protocol/canonical.md)
- OpenAPI v2: [openapi/v2.yaml](openapi/v2.yaml)
- OpenAPI usage/download: [docs/openapi.md](docs/openapi.md)
- Failure modes: [docs/failure-modes.md](docs/failure-modes.md)
- Security model: [docs/security-model.md](docs/security-model.md)
- Performance considerations: [docs/performance-considerations.md](docs/performance-considerations.md)
- Observability: [docs/observability.md](docs/observability.md)
- Adapter standards: [docs/adapter-standards.md](docs/adapter-standards.md)
- Versioning policy: [docs/versioning.md](docs/versioning.md)

## Package Groups

### Core

- `@valuya/core`
- `@valuya/agent`
- `@valuya/cli`

### JavaScript/TypeScript adapters

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
- `@valuya/telegram-bot`
- `@valuya/discord-bot`
- `@valuya/agentokratia-signer`
- `@valuya/reverse-proxy`

### Python adapters

- `valuya-guard` (AWS Lambda)
- `valuya-fastapi`
- `valuya-django`

### Other ecosystems

- `valuya/guard-laravel`
- `valuya-guard-rails`
- `valuya-guard-spring-boot-starter`
- `github.com/valuya/go-guard`

### Infrastructure templates

- `@valuya/nginx-auth-request`
- `@valuya/kubernetes`
- `docker/gateway`

## Trust & Governance

- License: [LICENSE](LICENSE)
- Security policy: [SECURITY.md](SECURITY.md)
- Support: [SUPPORT.md](SUPPORT.md)
- Contributing guide: [CONTRIBUTING.md](CONTRIBUTING.md)
- Code of conduct: [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md)

## Publishing

- npm publish: `pnpm publish:next`
- npm dry run: `pnpm publish:next:dry`
- PyPI publish: `pnpm publish:python`
- PyPI dry run: `pnpm publish:python:dry`

## Packaging

- Distribution/install matrix: [docs/packaging.md](docs/packaging.md)
