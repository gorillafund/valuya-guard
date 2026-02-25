# Reverse Proxy Mode

Valuya Guard can protect upstream apps without code changes via a gateway + proxy templates.

## Components

- Gateway service: `docker/gateway`
- Nginx template: `packages/reverse-proxy/templates/nginx/auth_request.conf`
- Traefik template: `packages/reverse-proxy/templates/traefik/dynamic.yml`
- Caddy template: `packages/reverse-proxy/templates/caddy/Caddyfile`

## Behavior

- entitlement active => `200` allow
- entitlement inactive:
  - web requests => `302` redirect to `payment_url`
  - API requests => `402` canonical JSON with `session_id` + `payment_url`

## Quick start

```bash
cd examples/reverse-proxy
docker compose up --build
```
