# Go net/http Adapter

Module: `github.com/valuya/go-guard`

Use `guard.Middleware(config)(next)` to protect routes.

Default behavior:
- HTML requests redirect to payment URL
- API requests return canonical 402 payload
