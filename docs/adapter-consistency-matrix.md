# Adapter Consistency Matrix

This matrix tracks consistency expectations across primary adapters.

| Adapter | Public API minimal | Web redirect | API 402 | Timeout config | Retry config | Logging guidance | Idempotency guidance |
|---|---|---|---|---|---|---|---|
| node-express | `valuyaExpress(opts)` | Yes | Yes | Via platform fetch timeout policy (recommended) | Adapter-level retry not enabled by default | App logger around middleware errors/denies | Deterministic idempotency key on checkout creation |
| fastapi | `ValuyaGuardMiddleware` | Yes | Yes | Requests timeout configurable in middleware | No built-in retries | Use app logger around middleware decisions | Server-driven checkout idempotency |
| go-guard | `guard.Middleware(config)` | Yes | Yes | Via HTTP client timeout | No built-in retries | Log request/resource/subject/decision | Deterministic repeated request handling |
| laravel | `ValuyaGuardMiddleware` | Yes | Yes | Config `timeout_ms` | No built-in retries | Use Laravel `Log` in middleware | Deterministic request context |
| rails | `ValuyaGuard::Middleware` + `ControllerProtect` | Yes | Yes | Config `timeout_ms` | No built-in retries | Add Rails structured logs in app | Deterministic request context |
| spring-boot | `ValuyaGuardFilter` starter | Yes | Yes | Config `valuya.timeout-ms` | No built-in retries | Use app logging around filter | Deterministic request context |
| reverse-proxy gateway | `/guard/check` | Yes | Yes | `VALUYA_TIMEOUT_MS` | `VALUYA_RETRY_MAX_ATTEMPTS`, `VALUYA_RETRY_BACKOFF_MS` | Structured JSON built-in | Deterministic resource mapping + backend idempotency |

## Legacy packages

- `github.com/valuya/go-middleware` is legacy; prefer `github.com/valuya/go-guard`.

## Enforcement

- Keep behavior aligned with `docs/protocol/canonical.md`.
- Validate with shared contract harness and CI checks.
