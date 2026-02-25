# Reverse Proxy Mode

Valuya Guard can protect upstream apps without changing app code via a gateway plus proxy templates.

## Components

- Gateway service: `docker/gateway`
- Nginx template: `packages/reverse-proxy/templates/nginx/auth_request.conf`
- Traefik template: `packages/reverse-proxy/templates/traefik/dynamic.yml`
- Caddy template: `packages/reverse-proxy/templates/caddy/Caddyfile`

## Gateway behavior

For `GET/POST /guard/check`:

- entitlement active => `200`
- entitlement inactive + HTML => `302` redirect to `payment_url`
- entitlement inactive + API => `402` canonical JSON payload
- backend/network/timeout/invalid subject => fail closed (`503` default)

## Gateway configuration

Required:

- `VALUYA_BASE`
- `VALUYA_TENANT_TOKEN` (or `VALUYA_SITE_TOKEN`)

Optional:

- `VALUYA_PLAN` (default: `standard`)
- `VALUYA_RESOURCE` (global explicit resource)
- `VALUYA_RESOURCE_RULES` (JSON array mapping path prefixes)
- `VALUYA_WEB_REDIRECT` (default: `true`)
- `VALUYA_TIMEOUT_MS` (default: `8000`)
- `VALUYA_RETRY_MAX_ATTEMPTS` (default: `2`)
- `VALUYA_RETRY_BACKOFF_MS` (default: `300,1200`)
- `VALUYA_FAIL_CLOSED_STATUS` (default: `503`)

`VALUYA_RESOURCE_RULES` example:

```json
[
  { "method": "GET", "path_prefix": "/api/premium", "resource": "http:route:GET:/api/premium" },
  { "path_prefix": "/admin", "resource": "web:section:admin" }
]
```

## Tracing and logging

- propagates/returns `X-Request-Id`
- structured JSON logs for allow/deny/error decisions

## Health endpoint

- `GET /healthz` => `200 {"ok":true,...}`

## Quick start

```bash
cd examples/reverse-proxy
docker compose up --build
```

## Performance notes

- Reverse proxy mode adds one auth hop.
- Keep gateway close to upstream app and backend network path.
- Tune timeout/retry conservatively for low p95 latency.
