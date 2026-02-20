---

## `SKILL.md` (Agent Skills spec) — “valuya-agent-cli”

Create a folder named `valuya-agent-cli/` and put this file at `valuya-agent-cli/SKILL.md`:

```md
---

name: valuya-agent-cli
description: Purchase and verify access to Valuya Guard resources via the Agent Payment Proof v2 flow (create checkout session, pay on-chain if needed, submit tx with signed proof, verify session, mint mandate). Use for debugging Guard agent payments, automating purchases, allowlisting wallets, and creating products for demos.
license: Proprietary
compatibility: Requires Node.js, the Valuya Guard API base URL, a tenant token, and (for paid flows) an EVM RPC URL plus an EVM private key.
metadata:
author: gorilla-funds
version: "1.0"

---

## Purpose

This skill helps an agent (or developer) use the **Valuya Guard Agent CLI** to:

- create checkout sessions for a `subject` buying a `plan` for a `resource`
- execute payment rails (primarily **ERC-20 on-chain transfer**)
- submit an **Agent Payment Proof v2** (signed by the paying wallet)
- verify the payment and mint a **mandate** (entitlement) in Guard
- manage operational prerequisites: **wallet allowlisting**, basic product creation

Use this skill when the task mentions:

- Guard agent payments, `agent:pay`, `submit-tx`, `verify`, mandates, entitlements
- wallet allowlists, tx proofs, signature verification, `wallet_mismatch`
- end-to-end payment demo automation (e.g. “telegram voice → buy coffee instantly”)

---

## Concepts and objects

### Subject

A principal identifier in `<type>:<id>` format (e.g. `user:3`, `anon:<uuid>`).
Guard uses it to mint mandates keyed by `(tenant_id, subject_type, subject_id, resource, plan, product_id)`.

### Resource

A deterministic canonical resource identifier (e.g. `n8n:workflow:<id>`).  
The **anchor_resource** is what mandates are keyed on and what proofs must bind to.

### Plan

Opaque string (e.g. `standard`, `free`). The plan is part of the mandate uniqueness key.

### Checkout session

Created by Guard. Includes pricing + routing fields that must match in the proof.

### Agent Payment Proof v2

A signed message binding:

- session_id
- tx_hash
- anchor_resource
- required_hash
- pricing_hash + quantity_effective
- chain_id + token_address + to_address + amount_raw + decimals
- expires_at

Guard recovers the address from `personal_sign` and enforces that it matches `wallet_address`.

---

## Recommended flow (one command)

Use the high-level command whenever possible.

### Command: `agent:pay` (env-driven)

Set:

- `VALUYA_BASE` (Guard base URL)
- `VALUYA_TENANT_TOKEN` (tenant bearer token)
- `VALUYA_SUBJECT` (`<type>:<id>`)
- `VALUYA_RESOURCE`
- `VALUYA_PLAN`
- `VALUYA_PRIVATE_KEY` (wallet used to pay + sign)
- `VALUYA_RPC_URL` (required for paid flows)

Optional:

- `VALUYA_POLL_INTERVAL` (ms)
- `VALUYA_POLL_TIMEOUT` (ms)

Run:

```bash
valuya agent:pay
# or: node dist/bin.js agent:pay
```

Expected outcome:

- prints "Mandate minted" and returns verification payload including mandate info.

## Debugging flows (step-by-step commands)

Use the low-level commands to debug each step in isolation:

### Command (Create Session): `agent:create-session`

```bash
pnpm dist/bin.js agent:create-session \
--base <BASE>
--tenant_token <TOKEN> \
--subject_type <TYPE>
--subject_id <ID> \
--resource <RESOURCE>
--plan <PLAN>
```

Safe session_id and inspect

- required_hash should match the hash of the GuardRequired object you sent
- pricing_hash should match the hash of the plan + quantity you sent
- anchor_resource should match the resource you sent
- payment fields (chain_id, token_address, to_address) should match what you expect for the plan
- anchor_resource should match the resource you sent
- expires_at should be in the future
- status should be "pending"

### Send the on-chain payment (if required)

Use your preferred method (e.g. Ethers.js script, Remix, MetaMask) to send the required payment transaction. Make sure to use the same wallet corresponding to `VALUYA_PRIVATE_KEY` and to send the correct amount to the correct address as specified in the session details.

### Command (Sign Proof): `agent:sign-proof`

```bash
pnpm dist/bin.js agent:sign-proof \
  --base <BASE> \
  --tenant_token <TOKEN> \
  --pk <PRIVATE_KEY> \
  --session_id <SESSION_ID> \
  --tx_hash <TX_HASH> \
  --expires_at <EXPIRATION_ISO>
```

Output includes the signature and the full proof JSON that you can submit in the next step as well as the wallet address derived from the private key.

### Command (Submit Tx + Proof): `agent:submit-tx`

```bash
pnpm dist/bin.js agent:submit-tx \
  --base <BASE> \
  --tenant_token <TOKEN> \
  --session-id <SESSION_ID> \
  --wallet_address <WALLET_ADDRESS> \
  --tx_hash <TX_HASH> \
  --signature <SIGNATURE> \
  --proof_json '<PROOF_JSON>'
```

### Command (Verify Session):

```bash
pnpm dist/bin.js agent:verify-session \
  --base <BASE> \
  --tenant_token <TOKEN> \
  --session-id <SESSION_ID> \
  --wallet_address <WALLET_ADDRESS>
```

If confirmed, this will mint the mandate and return the mandate details in the response and the state changes to confimation. If the wallet address doesn't match the one recovered from the signature, you'll get a `wallet_mismatch` error.

Operational notes:

Wallet allowlisting: Make sure the wallet you're using for payment is allowlisted in the Guard tenant. You can manage the allowlist via the Guard dashboard or API if your token has the necessary permissions.

node dist/bin.js agent:allowlist-wallet \
 --base <BASE> \
 --principal_subject_type <TYPE> \
 --principal_subject_id <ID> \
 --wallet_address <WALLET_ADDRESS> \
 --tenant_id <TENANT_ID> \
 --project_id <PROJECT_ID> \
 --resource-prefix <RESOURCE_PREFIX> \
 --action add|remove
--tenant_token <TOKEN> \
 --wallet_address <WALLET_ADDRESS> \

```

Notes:
- allowlists can be scoped by tenant_id, project_id or global, and action (add/remove)
- opitions for principal_subject_type/id allow you to specify a subject to wallet mapping if desired, otherwise it defaults to allowing that wallet for any subject (useful for testing)
```

node dist/bin.js agent:create-product \
 --base <BASE> \
 --tenant_token <TOKEN> \
 --description <DESCRIPTION> \
 --currency <CURRENCY> \
 --amount <AMOUNT> \
 --interval <INTERVAL> \
 --plan <PLAN> \  
 ``
