# Contributing

## Development Principles

- Preserve protocol compatibility unless change is explicitly versioned.
- Keep fail-closed behavior for authorization checks.
- Prefer canonical contract sources over ad-hoc docs.

## Local Setup

```bash
pnpm install
```

## Validation

Run before opening PRs:

```bash
pnpm run validate:all
```

## Pull Request Requirements

- tests for behavior changes
- docs updates for public API changes
- no protocol drift from `docs/protocol/canonical.md` and `openapi/v2.yaml`
- clear migration notes for any compatibility impact

## Commit Guidance

Use conventional commit style where practical:

- `feat(...)`
- `fix(...)`
- `docs(...)`
- `chore(...)`
- `test(...)`
