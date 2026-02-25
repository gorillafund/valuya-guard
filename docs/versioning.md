# Versioning & Compatibility

## Semantic Versioning

This repository follows semantic versioning for published packages:

- MAJOR: breaking API or behavior changes
- MINOR: backward-compatible feature additions
- PATCH: backward-compatible fixes

## Protocol Stability

Canonical protocol sources:

- `docs/protocol/canonical.md`
- `openapi/v2.yaml`

Compatibility expectations:

- Adding optional fields is backward compatible.
- Existing required fields and semantics must not change without a version bump.
- Adapter behavior must remain aligned to canonical allow/deny semantics.

## Adapter Compatibility Guarantees

All supported adapters guarantee:

- deterministic resource/plan/subject handling
- fail-closed guard behavior on backend/transport errors
- web redirect default for HTML requests
- canonical `402 payment_required` JSON for API requests

## Legacy Compatibility

See `docs/supported-vs-legacy.md` for explicitly supported compatibility paths and migration notes.
