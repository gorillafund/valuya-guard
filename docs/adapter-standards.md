# Adapter Standards

All adapters should converge on these guarantees.

## Public API

- Minimal surface area
- Deterministic resource + subject resolution
- Explicit configuration with safe defaults

## Behavior

- active entitlement => allow
- inactive entitlement + HTML => redirect
- inactive entitlement + API => canonical 402 JSON
- backend outage => fail closed

## Config knobs

- base URL + tenant token
- default plan/resource
- timeout
- retry (where applicable)
- web redirect toggle

## Logging

- structured logs preferred
- include request ID, subject ID, resource, decision, session ID when available
- never log secrets/tokens

## Tests

- contract tests for allow/deny/redirect/402/fail-closed
- adapter-specific tests for resolver and config behavior

## Documentation

Each adapter must include:

- package README
- docs page
- runnable example
- env var list
