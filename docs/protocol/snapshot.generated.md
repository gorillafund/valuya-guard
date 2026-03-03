# Protocol Snapshot (Generated)

## Endpoints
- `POST /api/v2/agent/products/prepare`
- `POST /api/v2/agent/products/resolve`
- `GET /api/v2/agent/products/schema/{type}`
- `GET /api/v2/agent/products/types`
- `POST /api/v2/checkout/sessions`
- `GET /api/v2/entitlements`

## Details

### `POST /api/v2/agent/products/prepare`
Required headers:
- (none)
Schema references:
- `#/components/responses/Error`

### `POST /api/v2/agent/products/resolve`
Required headers:
- (none)
Schema references:
- `#/components/responses/Error`
- `#/components/schemas/ProductResolveResponse`

### `GET /api/v2/agent/products/schema/{type}`
Required headers:
- (none)
Schema references:
- `#/components/responses/Error`

### `GET /api/v2/agent/products/types`
Required headers:
- (none)
Schema references:
- `#/components/responses/Error`

### `POST /api/v2/checkout/sessions`
Required headers:
- (none)
Schema references:
- `#/components/responses/Error`
- `#/components/schemas/AgentCheckoutSessionResponseV2`
- `#/components/schemas/CheckoutSessionCreateRequest`
- `#/components/schemas/PaymentRequiredBodyV2`

### `GET /api/v2/entitlements`
Required headers:
- `X-Valuya-Subject-Id`
Schema references:
- `#/components/responses/Error`
- `#/components/schemas/EntitlementsResponse`
