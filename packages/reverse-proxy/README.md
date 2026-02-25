# @valuya/reverse-proxy

Drop-in reverse proxy templates for Valuya Guard.

Includes:
- `templates/nginx/auth_request.conf`
- `templates/traefik/dynamic.yml`
- `templates/caddy/Caddyfile`

Use with `docker/gateway` service to protect any upstream app without app code changes.
