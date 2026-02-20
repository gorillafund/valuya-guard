# Valuya Guard — Agent CLI

A small CLI to **purchase access** (create checkout session → pay on-chain if needed → submit signed proof → verify → mint mandate),
plus a couple of **admin helpers** (e.g. wallet allowlisting, product creation).

This CLI is meant to be used by:

- **Agents** (OpenClaw / headless automations) that need to buy access to a resource
- **Developers** debugging the Guard payment protocol end-to-end

---

## Commands overview

### High-level “do it all” purchase flow

- `valuya agent:pay`

Creates a checkout session, pays (if needed), submits the signed proof, verifies, and ends with a minted mandate.

This command is **env-driven** (no flags), so it’s easy to run in CI or from other agents.

Required env vars:

| Env var               | Example                     | Description                                            |
| --------------------- | --------------------------- | ------------------------------------------------------ |
| `VALUYA_BASE`         | `https://pay.gorilla.build` | Guard base URL                                         |
| `VALUYA_TENANT_TOKEN` | `...`                       | Tenant bearer token                                    |
| `VALUYA_SUBJECT`      | `user:3` or `anon:<uuid>`   | Subject in `<type>:<id>` format                        |
| `VALUYA_RESOURCE`     | `n8n:workflow:abc...`       | Resource identifier                                    |
| `VALUYA_PLAN`         | `standard`                  | Plan to buy                                            |
| `VALUYA_PRIVATE_KEY`  | `0x...`                     | EVM private key used to pay + sign proof               |
| `VALUYA_RPC_URL`      | `https://...`               | RPC URL for on-chain payment (required for paid flows) |

Optional env vars:

| Env var                | Default | Description         |
| ---------------------- | ------: | ------------------- |
| `VALUYA_POLL_INTERVAL` |  `3000` | Poll interval in ms |
| `VALUYA_POLL_TIMEOUT`  | `60000` | Poll timeout in ms  |

Run:

```bash
node dist/bin.js agent:pay
# or if your package exposes it as a bin:
valuya agent:pay

## Low-level debugging commands (step-by-step)

These commands are useful when you want to debug each protocol step in isolation.

# Create Checkout Session

pnpm dist/bin.js agent:create-session \
--base https://pay.gorilla.build \
--tenant_token $Token \
--subject_type user \
--subject_id <user-id> \
--resource <resource> \
--plan standard

# Sign Agent Proof

pnpm dist/bin.js agent:sign-proof \
  --base https://pay.gorilla.build \
  --tenant_token $TOKEN \
  --pk 0xYOUR_PRIVATE_KEY \
  --session_id cs... \
  --tx_hash 0x... \
  --expires_at 2026-02-20T12:00:00Z

# Submit tx + proof

pnpm dist/bin.js agent:submit-tx \
  --base https://pay.gorilla.build \
  --tenant_token $TOKEN \
  --session-id cs... \
  --wallet_address 0x... \
  --tx_hash 0x... \
  --signature 0x... \
  --proof_json '{"session_id":"...","tx_hash":"...","anchor_resource":"...","required_hash":"...","pricing_hash":"...","quantity_effective":1,"chain_id":1,"token_address":"0x...","to_address":"0x...","amount_raw":"...","decimals":18,"expires_at":"..."}'

# Verfiy Session (binds verify to the wallet used in submit-tx)

pnpm dist/bin.js agent:verify-session \
  --base https://pay.gorilla.build \
  --tenant_token $TOKEN \
  --session-id cs... \
  --wallet_address 0xYOUR_WALLET

## Admin Helpers
# Add a wallet to the allowlist

pnpm dist/bin.js agent:allowlist:add \
  --base https://pay.gorilla.build \
  --tenant_token $TOKEN \
  --principal_subject_type user \
  --principal_subject_id 3 \
  --wallet_address 0x... \
  --tenant_id 2 \
  --product_id 16 \
  --plan standard \
  --resource_prefix n8n:workflow:

# Create a Product

pnpm dist/bin.js agent:create-product \
 --base https://pay.gorilla.build \
 --tenant_token $TOKEN \
 --name "Coffee @ Rivas" \
 --description "Buy me a coffee at Rivas. \
 --currency EUR


```
