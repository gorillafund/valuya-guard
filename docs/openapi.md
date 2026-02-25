# OpenAPI

Canonical OpenAPI contract file:

- [`openapi/v2.yaml`](../openapi/v2.yaml)

## Download

```bash
curl -L https://raw.githubusercontent.com/gorillafund/valuya-guard/main/openapi/v2.yaml -o valuya-openapi-v2.yaml
```

## Validate in CI

CI runs structural + drift checks:

- `node scripts/ci/validate-openapi.js`
- `node scripts/ci/check-contract-drift.js`
