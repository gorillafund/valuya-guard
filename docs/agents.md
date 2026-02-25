# Agents

Valuya supports end-to-end agent purchase and invocation workflows.

## Primary packages

- `@valuya/agent`: core API client + purchase/verify flows
- `@valuya/agentokratia-signer`: Guardian wallet bridge
- `@valuya/cli`: operational and debugging command surface

## Canonical agent flow

1. `GET /api/v2/agent/whoami`
2. `POST /api/v2/agent/products/resolve`
3. `POST /api/v2/checkout/sessions`
4. `POST /api/v2/agent/sessions/{session_id}/tx`
5. `POST /api/v2/agent/sessions/{session_id}/verify`
6. optional `access.invoke` execution

## Key constraints

- Client must not synthesize `resource`, `plan`, `subject`, or invoke routing.
- Resolve context from backend and execute exactly.
- Respect `invoke v1` timeout/retry policy.

## References

- [RFC_AGENT_CLIENT_PROTOCOL_V1.md](../RFC_AGENT_CLIENT_PROTOCOL_V1.md)
- [protocol/canonical.md](protocol/canonical.md)
- [agentokratia-guardian-integration.md](agentokratia-guardian-integration.md)
