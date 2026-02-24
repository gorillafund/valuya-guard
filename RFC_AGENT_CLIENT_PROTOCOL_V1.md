# RFC: Valuya Agent Client Protocol v1

Status: Draft (implementation-target)  
Version: `1.0.0`  
Audience: Backend + Agent SDK/CLI implementers

---

## 1. Goal

Define one stable, backend-driven contract for agent workflows:

1. Identity resolution
2. Product discovery/resolution
3. Deterministic product authoring
4. Payment + entitlement verification
5. Post-payment invoke execution

Client must not synthesize business-critical access data (`resource`, `subject`, `plan`, invoke payload logic).

---

## 2. Transport & Auth

Base URL: tenant backend (for example `https://pay.gorilla.build`)  
Auth header: `Authorization: Bearer <tenant_or_agent_token>`  
Content type: JSON for request/response bodies.

All JSON API errors must be JSON (never HTML).

---

## 3. Global Response Envelope

Success:

```json
{ "ok": true, "...": "..." }
```

Error:

```json
{
  "ok": false,
  "error": "product_not_found",
  "message": "Optional human-readable message",
  "request_id": "trace-id",
  "details": {}
}
```

`error` is machine-stable; `message` is non-stable human text.

---

## 4. Canonical Error Codes

Required cross-endpoint codes:

1. `tenant_token_required`
2. `principal_not_bound`
3. `subject_required`
4. `invalid_product_ref`
5. `product_not_found`
6. `insufficient_scope`
7. `invalid_request`
8. `internal_error`

Checkout/payment path may additionally return:

1. `payment_required`
2. `session_not_found`
3. `session_expired`
4. `invalid_signature`
5. `wallet_not_allowlisted`
6. `tx_hash_reused`

---

## 5. Endpoint Contracts

### 5.1 `GET /api/v2/agent/whoami`

Purpose: resolve token identity + principal binding.

Response:

```json
{
  "ok": true,
  "agent": {
    "token_id": "4",
    "wallet_address": "0x...",
    "scopes": ["agent:products:read"]
  },
  "principal": {
    "subject": { "type": "user", "id": "1" }
  },
  "tenant": { "id": 1, "slug": "workspace" },
  "capabilities": {
    "invoke_v1": true,
    "product_prepare": true,
    "product_schema": true
  }
}
```

`capabilities` is optional but recommended for feature negotiation.

### 5.2 `POST /api/v2/agent/products/resolve`

Request (one discriminator):

```json
{ "product_id": 1 }
```

```json
{ "slug": "n8n-workflow" }
```

```json
{ "external_id": "ext-123" }
```

Response:

```json
{
  "ok": true,
  "product": { "id": 1, "slug": "n8n-workflow", "plan": "standard" },
  "access": {
    "resource": "n8n:workflow:n8n-workflow",
    "visit_url": null,
    "plan": "standard",
    "required": { "type": "subscription", "plan": "standard" },
    "quantity_default": 1,
    "subject": { "type": "user", "id": "2" },
    "principal": { "type": "user", "id": "2" },
    "invoke": {
      "version": "1",
      "method": "POST",
      "url": "https://...",
      "headers": { "content-type": "application/json" },
      "body": { "subject": { "type": "user", "id": "2" } },
      "timeout_ms": 15000,
      "retry_policy": { "max_attempts": 2, "backoff_ms": [300, 1200] }
    }
  }
}
```

### 5.3 `GET /api/v2/agent/products/types`

Response:

```json
{
  "ok": true,
  "types": [
    {
      "key": "n8n_workflow_access",
      "label": "n8n Workflow Access",
      "description": "Workflow access product",
      "pricing_modalities": ["subscription", "one_time", "usage"],
      "requires": ["access.workflow_id"]
    }
  ]
}
```

### 5.4 `GET /api/v2/agent/products/schema/{type}`

Response:

```json
{
  "ok": true,
  "type": "n8n_workflow_access",
  "pricing_modalities": ["subscription", "one_time", "usage"],
  "json_schema": { "type": "object", "properties": {} },
  "examples": [{ "type": "n8n_workflow_access" }]
}
```

### 5.5 `POST /api/v2/agent/products/prepare`

Purpose: deterministic normalization and resource construction server-side.

Request:

```json
{
  "type": "n8n_workflow_access",
  "name": "Workflow Pro",
  "access": { "workflow_id": "my-flow" },
  "pricing_modality": "subscription",
  "plan": "standard"
}
```

Response:

```json
{
  "ok": true,
  "resource": "n8n:workflow:my-flow",
  "product": {
    "type": "n8n_workflow_access",
    "name": "Workflow Pro",
    "resource": "n8n:workflow:my-flow",
    "pricing_modality": "subscription",
    "plan": "standard"
  },
  "warnings": []
}
```

---

## 6. Invoke v1 Contract

`access.invoke.version` MUST be `"1"` for this contract.

Shape:

```json
{
  "version": "1",
  "method": "POST|GET|PUT|PATCH|DELETE",
  "url": "https://...",
  "headers": { "...": "..." },
  "body": {},
  "timeout_ms": 15000,
  "retry_policy": {
    "max_attempts": 2,
    "backoff_ms": [300, 1200]
  }
}
```

Rules:

1. Client executes as provided.
2. No client-side placeholder synthesis.
3. No resource/plan/subject rewriting.
4. Retry only per `retry_policy`.
5. Timeouts per `timeout_ms`.

Allowed client runtime additions (if configured locally):

1. Optional extra auth for resource host (for example app bearer), only when backend does not already provide that header.
2. Correlation headers (`X-Request-Id`) may be appended.

---

## 7. Determinism Invariants

Backend must enforce internal consistency:

1. `product_id` ↔ `slug` ↔ `resource` ↔ `plan` must resolve to one canonical record.
2. `prepare` and `create` must share normalization pipeline.
3. If request includes manual `resource`, reject on mismatch with deterministic derived resource.
4. Checkout must fail with typed 4xx error on inconsistency (never raw 500 HTML).

---

## 8. Compatibility Policy

Backward-compatible changes:

1. Add optional fields.
2. Add new endpoints.
3. Add new error codes (without changing existing semantics).

Breaking changes (require new major protocol version):

1. Remove/rename required fields.
2. Change existing field meaning/type.
3. Change invoke execution semantics.

Deprecation policy:

1. Mark deprecated fields for at least one minor cycle.
2. Provide replacement and migration note.

---

## 9. Conformance Test Matrix

Minimum integration tests:

1. `whoami` success + principal binding.
2. `resolve` success with invoke v1.
3. `resolve` `product_not_found`.
4. `prepare` deterministic resource generation.
5. pay -> verify -> invoke happy path.
6. invoke retry path on transient failure.
7. scope denial (`insufficient_scope`).
8. all errors returned as JSON envelope with `request_id`.

---

## 10. Observability

Each endpoint should emit/propagate:

1. `request_id`
2. `tenant_id`
3. `token_id`
4. `subject_key` where available
5. `product_id` where available
6. `session_id` on checkout/payment paths

Recommended correlation chain:

`resolve_request_id -> checkout_request_id -> verify_request_id -> invoke_request_id`

