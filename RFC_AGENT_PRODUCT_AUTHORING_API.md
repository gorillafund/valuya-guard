# RFC: Agent Product Authoring API (Deterministic v1)

## Goal

The agent must not construct canonical `resource` strings by itself.
Backend owns deterministic resource construction and validation.

The agent should:
1. Discover available product types.
2. Discover required fields/schema per product type.
3. Choose pricing modality and commercial params.
4. Ask backend to prepare canonical product payload.
5. Submit prepared payload through signed challenge flow.

## Endpoints

### 1) `GET /api/v2/agent/products/types`

Returns supported product type catalog:

```json
{
  "ok": true,
  "types": [
    {
      "key": "telegram_premium_chat",
      "label": "Telegram Premium Chat",
      "pricing_modalities": ["subscription", "one_time"],
      "requires": ["chat_id", "plan", "price"]
    }
  ]
}
```

### 2) `GET /api/v2/agent/products/schema/{type}`

Returns JSON schema + examples for draft payload:

```json
{
  "ok": true,
  "type": "telegram_premium_chat",
  "pricing_modalities": ["subscription", "one_time"],
  "json_schema": { "type": "object", "properties": {} },
  "examples": [{ "type": "telegram_premium_chat", "pricing": {} }]
}
```

### 3) `POST /api/v2/agent/products/prepare`

Input: draft product intent (type + business/pricing fields).
Output: normalized deterministic payload ready for create.

```json
{
  "ok": true,
  "resource": "telegram:bot:premium_chat:123456",
  "product": {
    "name": "Premium Chat",
    "resource": "telegram:bot:premium_chat:123456",
    "plan": "pro",
    "pricing": { "mode": "subscription", "amount_cents": 990, "currency": "EUR" }
  },
  "warnings": []
}
```

## Creation flow

1. `GET /types`
2. `GET /schema/{type}`
3. Agent picks pricing modality and commercial params.
4. `POST /prepare`
5. Existing signed creation flow: `POST /api/v2/agent/products`

## Determinism rules

1. Backend computes canonical `resource`.
2. Backend rejects manual resource override unless exact deterministic match.
3. `prepare` and `create` must use same normalization/hashing rules.
4. Idempotency should be enforced on canonical identity tuple (tenant + resource + plan + pricing key fields).

