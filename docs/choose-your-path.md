# Choose Your Path

## 1) Website paywall

Use middleware in your web framework.

Start with:

- Express: [node-express.md](node-express.md)
- Next.js: [nextjs.md](nextjs.md)
- FastAPI: [fastapi.md](fastapi.md)
- Laravel: [laravel.md](laravel.md)
- Rails: [rails.md](rails.md)
- Spring Boot: [spring-boot.md](spring-boot.md)

Default outcome: denied web requests redirect to payment page.

## 2) API monetization

Use server adapters that emit canonical API response:

- HTTP `402`
- JSON `payment_required`
- includes `payment_url` + `session_id`

See: [payment-flows.md](payment-flows.md)

## 3) Agent pay-per-call

Use:

- `@valuya/agent`
- optional wallet bridge `@valuya/agentokratia-signer`

Flow:

- resolve context
- create checkout
- submit tx proof
- verify
- invoke

## 4) Reverse proxy drop-in

Protect existing apps without changing app code:

- Nginx: `@valuya/reverse-proxy` templates
- Traefik: `@valuya/reverse-proxy` templates
- Caddy: `@valuya/reverse-proxy` templates
- Gateway: `docker/gateway`

See: [reverse-proxy.md](reverse-proxy.md)
