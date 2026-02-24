# RFC: Agent Context Resolution API (v2)

## Goal

Allow agent tooling to execute payment and product workflows with only:

1. `VALUYA_BASE`
2. `VALUYA_TENANT_TOKEN`
3. (for on-chain pay) signer credentials (`VALUYA_PRIVATE_KEY`, `VALUYA_RPC_URL`)

No manual `subject`, `resource`, or `plan` should be required for the common flow.

## Endpoints

### 1) `GET /api/v2/agent/whoami`

Resolves token-bound principal identity.

Example response:

```json
{
  "ok": true,
  "agent": {
    "token_id": "agt_123",
    "wallet_address": "0xabc...",
    "scopes": ["products:read", "checkout:create", "agent:pay"]
  },
  "principal": {
    "subject": { "type": "user", "id": "123" }
  },
  "tenant": { "id": 7, "slug": "acme" }
}
```

### 2) `POST /api/v2/agent/products/resolve`

Maps product reference to actionable access context.

Request body (one of):

```json
{ "product_id": 42 }
```

```json
{ "slug": "premium-chat" }
```

```json
{ "external_id": "prod_external_1" }
```

Example response:

```json
{
  "ok": true,
  "product": { "id": 42, "slug": "premium-chat", "plan": "pro" },
  "access": {
    "resource": "telegram:bot:premium_chat",
    "plan": "pro",
    "required": { "type": "subscription", "plan": "pro" },
    "quantity_default": 1,
    "subject": { "type": "user", "id": "123" },
    "principal": { "type": "user", "id": "123" }
  }
}
```

## Error codes

1. `principal_not_bound`
2. `product_not_found`
3. `insufficient_scope`
4. `invalid_product_ref`
5. `tenant_token_required`

## CLI/SDK expected behavior

1. `agent:whoami` uses `GET /api/v2/agent/whoami`.
2. `agent:product:resolve --product <ref>` uses `POST /api/v2/agent/products/resolve`.
3. `agent:pay --product <ref>`:
- calls whoami + resolve
- derives `subject`, `resource`, `plan`, `required`, `quantity_requested`
- executes existing checkout/pay/verify flow

## Backward compatibility

`agent:pay` keeps legacy explicit mode:

1. `VALUYA_SUBJECT`
2. `VALUYA_RESOURCE`
3. `VALUYA_PLAN`

If all are provided, explicit mode is used. Otherwise, product-resolved mode is used.

