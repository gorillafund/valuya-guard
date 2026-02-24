# Valuya Guard Repository Map (Source of Truth)

This document defines what is canonical today, what is legacy, and the minimal path to make all SDK layers consistent.

## 1) Canonical Packages

1. `packages/core`
- Canonical protocol and wire contracts for v2.
- Owns checkout/payment/proof/entitlement response shapes.
- Current exports are v2-style (`paymentRequiredResponseV2`, protocol/canon/crypto/domain).

2. `packages/agent`
- Canonical headless API client and end-to-end purchase orchestration.
- Builds successfully (`pnpm --filter @valuya/agent build`).
- Uses `@valuya/core` v2 types for session/proof/verify flow.

3. `packages/aws-lambda-python`
- Working adapter pattern for Lambda proxy (`402` flow + checkout session creation).
- Uses simpler subject header model than Node adapter but internally coherent.

## 2) Non-Canonical / Drifted Areas

1. `packages/aws-lambda-node`
- Currently broken against current `packages/core`.
- Fails on missing exports: `Subject`, `paymentRequiredResponse`, `httpRouteResource`.
- Indicates adapter was written against older core API.

2. `sam-app/vendor/*`
- Vendored copy of old packages, including old `core` symbols (`Subject`, `httpRouteResource`, `paymentRequiredResponse`).
- Duplicates logic and can drift from `packages/*`.

3. Agent module duplication
- `packages/agent/src/modules/agentProducts.ts` exists but is not exported from module index.
- Similar logic also exists in `packages/agent/src/modules/products.ts` (exported path).

## 3) Canonical API-Client Call Flow (Current Best Path)

1. Create checkout session:
- `POST /api/v2/checkout/sessions` (with `mode: "agent"`).
- File: `packages/agent/src/modules/checkoutSessions.ts`.

2. Build and sign proof:
- Build from session (`anchor_resource`, `required_hash`, `pricing_hash`, `quantity_effective`, payment routing).
- Message format from `@valuya/core`.
- Files: `packages/agent/src/protocol/buildProof.ts`, `packages/core/src/crypto/agentProof.ts`.

3. Submit tx + proof:
- `POST /api/v2/agent/sessions/{id}/tx`.
- File: `packages/agent/src/protocol/sessions.ts`.

4. Verify until entitlement is minted:
- `POST /api/v2/agent/sessions/{id}/verify` in polling loop.
- Files: `packages/agent/src/protocol/sessions.ts`, `packages/agent/src/utils/poll.ts`.

## 4) Minimal Refactor Plan

### Phase 1: Unblock Build Consistency (Smallest Safe Changes)

1. Fix `@valuya/aws-lambda-node` against current core exports.
- Replace `paymentRequiredResponse` usage with `paymentRequiredResponseV2`.
- Reintroduce local `httpRouteResource` helper in adapter, or move helper into core canon and export it.
- Replace `Subject` import usage with local adapter subject type (`{ type: string; id: string }`) or align to current core subject contract.

2. Keep behavior unchanged:
- Same `allowed -> handler` / `denied -> 402` semantics.
- Same subject resolution strategy and idempotency key behavior.

### Phase 2: Remove Internal Duplication

1. Agent products:
- Pick one implementation (`modules/products.ts`) as canonical.
- Remove or archive `modules/agentProducts.ts`.

2. HTTP usage in agent modules:
- Normalize modules (`allowlist`, `products`) to use shared `apiJson` + shared error type (`ValuyaApiError`) instead of ad-hoc `fetch` + plain `Error`.

### Phase 3: Vendor Strategy Cleanup

Choose one:
1. Keep vendoring intentionally:
- Add explicit sync contract and CI check that vendor tree matches `packages/*`.

2. Prefer workspace packages in `sam-app`:
- Remove vendored package copies and import from built workspace packages instead.
- This is cleaner long-term and avoids version skew.

## 5) Recommended Immediate Source-of-Truth Policy

1. Protocol truth: `packages/core`.
2. Headless client truth: `packages/agent`.
3. Integration adapters must compile against current `packages/core` before release.
4. `sam-app/vendor` should be treated as generated snapshot output, not design-time source.

## 6) Verification Commands

```bash
pnpm --filter @valuya/core build
pnpm --filter @valuya/agent build
pnpm --filter @valuya/aws-lambda-node build
```

Current status at analysis time:
1. `core`: passes.
2. `agent`: passes.
3. `aws-lambda-node`: fails due to core export drift (expected until Phase 1 is applied).
