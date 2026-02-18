# Valuya Agent CLI

This CLI lets an **agent wallet** (allowlisted) operate Valuya as a first-class actor:

- list products
- create products (merchant flow)
- purchase products (buyer flow) via checkout session + on-chain payment + proof submission
- verify sessions
- fetch entitlements

## Concepts

### Tenant Token

A `TenantToken` authenticates API calls (Authorization: Bearer ...).  
It contains `scopes[]` which define what the token can do.

Examples:

- `agent:product:read`
- `agent:product:create`
- `checkout:session:create` (if you separate)
- `agent:checkout:pay`
- `agent:session:verify`
- `entitlements:read`

### Agent Wallet (EOA or contract wallet)

The wallet signs proofs for certain guarded actions (e.g. product creation).
Wallets must be allowlisted in `SubjectWalletAllowlist`.

## Install

```bash
pnpm i
pnpm build
```

## Configuration

VALUYA*BASE="https://pay.gorilla.build"
VALUYA_TENANT_TOKEN="ttok*..."
VALUYA_SUBJECT="user:id"

# Wallet used to sign agent proofs (EOA)

VALUYA_PRIVATE_KEY="0xabc..."

## List Products

pnpm cli agent:product:list
pnpm cli agent:product:list --q "staking" --limit 50
pnpm cli agent:product:list --cursor 200

## Create Products

pnpm cli agent:product:list
pnpm cli agent:product:list --q "staking" --limit 50
pnpm cli agent:product:list --cursor 200

export PRODUCT_NAME="Test Product"
export PRODUCT_SLUG="test-product-1"
export PRODUCT_DESCRIPTION="Created via CLI"
export PRODUCT_CATEGORY="api"
export PRODUCT_TAGS="dev,test"
export PRODUCT_GATEWAY_RESOURCE="checkout.api.test"
export PRODUCT_PRICE_CENTS="99"

pnpm cli agent:product:create

## Purchase Product

This wraps:

- create Checkout Session
- on-chain transfer
- submit tx proof
- poll verify Session until confirmed
- fetch entitlements

export PLAN="pro"
export RESOURCE="checkout.api.test"
export CURRENCY="EUR"
export AMOUNT_CENTS="99"

# chain payment fields depend on your payment instruction payload

pnpm cli agent:product:purchase

## Verify a session (debug)

pnpm cli agent:session:verify --session <id> --from 0x...

## Fetch Entitlements (debug)

pnpm cli agent:entitlements --plan pro --ressource checkout.api.test --subject user:id

## OpenClaw “Skill” spec (detailed)

Below is a practical skill that an LLM agent can execute safely. Adjust naming to your OpenClaw format.

# Skill: valuya_agent_commerce

## Goal

Enable an automated agent to:

- list products
- create products (if authorized)
- purchase products and confirm access
  using a Tenant Token + an Agent Wallet (signer).

## Inputs

- VALUYA_BASE (string)
- VALUYA_TENANT_TOKEN (string, bearer token)
- PRINCIPAL (string "tenant:<id>" or "user:<id>")
- WALLET_SIGNER (EOA private key OR contract-wallet signing adapter)
- Optional: search query, product spec, purchase spec

## Preconditions / Security

1. Never print private keys.
2. Tenant token is shown once; treat it as secret.
3. If token lacks scope, stop and ask for a token with required scopes.
4. For create-product flow: wallet must be allowlisted and permitted.

## Actions

### A) ListProducts

Call:

- GET /api/v2/agent/products?q=&limit=&cursor=
  Requires scope:
- agent:product:read

Return:

- items[] with id, slug, name, gateway_resource, pricing
- next_cursor for pagination

### B) CreateProduct

Steps:

1. Compute canonical JSON of product payload (stable sorted keys)
2. request_sha256 = sha256(canonical_json)
3. POST /api/v2/agent/challenges with:
   - principal_subject_type, principal_subject_id
   - wallet_address
   - action = "product:create"
   - request_sha256
4. Receive:
   - nonce, expires_at, message
5. Sign message with wallet signer (personal_sign)
6. POST /api/v2/agent/products with:
   - principal_subject_type, principal_subject_id
   - wallet_address
   - nonce
   - signature
   - request_sha256
   - product payload
7. Verify response ok + product_id

Requires scope:

- agent:product:create

Failure modes:

- 403 wallet_not_allowlisted → stop, instruct allowlist
- 422 request_hash_mismatch → check canonicalization rules

### C) PurchaseProduct

Steps:

1. FetchEntitlements(plan, resource, subject)
   - if active: stop (already has access)
2. CreateCheckoutSession(plan, resource, subject, currency, amount)
3. SendTransaction(payment instruction) → txHash
4. SignAgentProof(sessionId, txHash, resource)
5. SubmitAgentTx(sessionId, txHash, from_address, signature)
6. Poll verifySession until ok or timeout
7. FetchEntitlements again to confirm active

Requires scopes (suggested):

- checkout:session:create
- agent:session:tx:submit
- agent:session:verify
- entitlements:read

## Outputs

- Product list OR product_id OR mandate_id + entitlement status
- Always include next steps if missing scopes / allowlist issues

## Observability

- Log request ids, session ids, tx hashes
- Never log secrets (token plaintext/private key)
