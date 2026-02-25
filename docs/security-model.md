# Security Model

## Access model

Valuya Guard enforces access through evaluated entitlements tied to:

- subject (`type:id`)
- resource
- plan / required policy

## Subject spoofing prevention

- Canonical header: `X-Valuya-Subject-Id`
- Integrations must derive subject from trusted auth context where possible.
- Anonymous fallback should be explicit, not implicit allow.

## Replay prevention

- Agent payment flows use backend verification and tx/session binding.
- Replayed tx/session submissions are rejected by backend constraints.

## Session binding

- Checkout/payment proof binds to session/resource/pricing hashes in agent flows.
- Verification endpoint enforces wallet/session consistency.

## Signature verification domain separation

- Agent proof signing is delegated to protocol-specific message construction in `@valuya/core`/`@valuya/agent`.
- Adapters should not invent custom signing domains.

## Idempotency

- Session creation supports idempotency where backend supports it.
- Adapters should keep deterministic keying strategy for repeated identical requests.

## Multi-tenant isolation

- Tenant token scopes authorization context.
- Adapters must always send the intended tenant token and never reuse across tenants implicitly.

## Allowlist enforcement

- Wallet allowlists and signature checks are enforced by backend payment verification endpoints.

## Rate limiting guidance

- Apply edge and application rate limits for repeated denied attempts.
- Monitor spikes in checkout creation and verification attempts.

## Fail-closed requirement

- On timeout/network/5xx/malformed subject: deny by default.
