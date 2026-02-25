# Traefik ForwardAuth Example

Use `dynamic.yml` with Traefik to call `valuya_guard_gateway` as forward auth.

Expected:
- allow => request passes to upstream app
- deny => 302 (web) or 402 (api) from gateway
