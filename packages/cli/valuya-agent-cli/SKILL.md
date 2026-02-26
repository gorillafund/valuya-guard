---
name: valuya-agent-cli
description: Use the Valuya Guard CLI for product-based purchases (`agent:buy`), payment+mandate flow (`agent:pay`), low-level proof debugging (`session:create`, `sign-proof`, `submit-tx`), and agent product/admin operations.
---

## When to use

Use this skill when tasks mention:

- Valuya Guard checkout/payment/mandate flows
- Agent Payment Proof v2 signing/submission issues
- product resolution, dry-run, invoke-v1 execution, or `agent:buy`
- CLI-based product creation or allowlist updates

## Command map

Use `valuya <command>` after installing the CLI package, or `node dist/bin.js <command>` in this package.

### Product-first purchase flow (recommended)

- `agent:buy --product <ref>`

What it does:

1. Resolves product purchase context.
2. Executes payment flow.
3. Verifies and mints mandate.
4. Executes backend-provided `access.invoke` when present; otherwise falls back to `visit_url` or `--resource-url`.

Useful flags:

- `--resource-url <url>` override resolved visit URL
- `--resource-auth <bearer>` bearer for resource call
- `--method <GET|POST|...>` method for visit fallback
- `--no-visit` skip post-payment resource call

Required env:

- `VALUYA_BASE`
- `VALUYA_TENANT_TOKEN`
- `VALUYA_PRIVATE_KEY`

Optional env:

- `VALUYA_RPC_URL` (required only for onchain payments)
- `VALUYA_POLL_INTERVAL` (default `3000`)
- `VALUYA_POLL_TIMEOUT` (default `60000`)
- `VALUYA_RESOURCE_AUTH`

### Env-driven pay flow

- `agent:pay [--product <ref>]`

Two modes:

- Explicit context mode: set `VALUYA_SUBJECT` (`<type>:<id>`), `VALUYA_RESOURCE`, `VALUYA_PLAN`.
- Product mode: provide `--product` or `VALUYA_PRODUCT`; context is resolved from backend.

Also requires:

- `VALUYA_BASE`
- `VALUYA_TENANT_TOKEN`
- `VALUYA_PRIVATE_KEY`
- `VALUYA_RPC_URL`

## Low-level debugging flow

Use these when isolating session/proof issues.

### 1) Create session

`session:create` uses global options (or env fallback):

- `--base <url>` / `VALUYA_BASE`
- `--tenant-token <token>` / `VALUYA_TENANT_TOKEN`

Required flags:

- `--subject <type:id>`
- `--resource <resource>`
- `--plan <plan>`

Optional:

- `--origin <origin>`
- `--quantity <n>`

Example:

```bash
node dist/bin.js --base https://pay.gorilla.build --tenant-token "$TOKEN" \
  session:create --subject user:123 --resource n8n:workflow:abc --plan standard
```

### 2) Build + sign proof from session

- `sign-proof`

Required flags:

- `--base <url>`
- `--tenant-token <token>`
- `--pk <privateKey>`
- `--session-id <id>`
- `--tx-hash <hash>`

Optional:

- `--rpc <url>`

Output includes:

- `wallet_address`
- `signature`
- `proof`

### 3) Submit tx with signed proof

- `submit-tx`

Required flags:

- `--base <url>`
- `--tenant-token <token>`
- `--pk <privateKey>`
- `--session-id <id>`
- `--tx-hash <hash>`

Optional:

- `--rpc <url>`

Note: CLI currently has no standalone `verify-session` command; full verify/mint is part of `agent:pay` and `agent:buy` flows.

## Product and admin helpers

### Product discovery/resolution

- `agent:products:list [--status ...] [--visibility ...] [--q ...] [--limit ...] [--cursor ...]`
- `agent:product:resolve --product <ref>`
- `agent:dry-run --product <ref>` (resolve without paying/invoking)
- `agent:whoami`

### Product authoring

- `agent:product:types`
- `agent:product:schema --type <type>`
- `agent:product:prepare --file <draft.json> [--out <path>]`
- `agent:product:create --file <product.json> [--prepare] [--subject <type:id>]`

`agent:product:create` requires env:

- `VALUYA_BASE`
- `VALUYA_TENANT_TOKEN`
- `VALUYA_PRIVATE_KEY`
- `VALUYA_RPC_URL`

### Allowlist

- `allowlist:add --file <allowlist.json>` (preferred)
- `allowlist:add --principal <type:id> --wallet <0x...> [--plan ...] [--resource-prefix ...] [--max-amount-cents ...] [--expires-at ...] [--status active|disabled]`

Requires env:

- `VALUYA_BASE`
- `VALUYA_TENANT_TOKEN`

## Troubleshooting shortcuts

- `product_not_found`: run `agent:products:list --q <term>`, then retry with `slug:<slug>` or `id:<n>`.
- `VALUYA_RPC_URL required for onchain payments in agent:buy`: set `VALUYA_RPC_URL` when payment method is onchain.
- `invoke_body_missing`: backend returned `body_template` without concrete `body`; refresh resolve context and retry.
- `principal_not_bound` on `agent:product:create`: use `--subject <type:id>` or bind principal to tenant token.
