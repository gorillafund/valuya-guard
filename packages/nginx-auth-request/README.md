# @valuya/nginx-auth-request

Nginx `auth_request` templates for Valuya Guard payment-aware authorization.

Use alongside an auth backend that responds with:
- `2xx` => allow
- `402` => payment required (with Valuya headers)
