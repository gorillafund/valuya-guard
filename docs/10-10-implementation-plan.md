# 10/10 Readiness Implementation Plan

Date: 2026-02-25
Input: `docs/10-10-audit-report.md`

## 1. Protocol Integrity

Required file changes:
- [docs/protocol/canonical.md](/home/colt/Software/valuya-guard/docs/protocol/canonical.md)
- [openapi/v2.yaml](/home/colt/Software/valuya-guard/openapi/v2.yaml)
- [scripts/ci/check-contract-drift.js](/home/colt/Software/valuya-guard/scripts/ci/check-contract-drift.js)
- [scripts/ci/validate-openapi.js](/home/colt/Software/valuya-guard/scripts/ci/validate-openapi.js)

New files required:
- [tests/contract/harness.mjs](/home/colt/Software/valuya-guard/tests/contract/harness.mjs)
- [tests/contract/gateway.contract.test.mjs](/home/colt/Software/valuya-guard/tests/contract/gateway.contract.test.mjs)

CI updates required:
- Add OpenAPI validation step
- Add contract drift validation step
- Add contract harness test step

Protocol drift risk:
- Low, if `canonical.md` and `openapi/v2.yaml` are changed in one PR and CI drift checks remain mandatory.

## 2. Fail-Closed Safety

Required file changes:
- [docker/gateway/server.js](/home/colt/Software/valuya-guard/docker/gateway/server.js)
- [packages/node-express/src/index.ts](/home/colt/Software/valuya-guard/packages/node-express/src/index.ts)
- [packages/fastapi/valuya_fastapi/middleware.py](/home/colt/Software/valuya-guard/packages/fastapi/valuya_fastapi/middleware.py)
- [docs/failure-modes.md](/home/colt/Software/valuya-guard/docs/failure-modes.md)

New files required:
- None

CI updates required:
- Keep gateway fail-closed tests mandatory
- Add adapter smoke checks per runtime

Protocol drift risk:
- None, behavior stays within canonical deny/allow model.

## 3. Adapter Consistency

Required file changes:
- [docs/adapter-standards.md](/home/colt/Software/valuya-guard/docs/adapter-standards.md)
- [docs/adapter-consistency-matrix.md](/home/colt/Software/valuya-guard/docs/adapter-consistency-matrix.md)
- Adapter READMEs for env/config parity

New files required:
- Missing adapter docs/examples where absent

CI updates required:
- Add runtime-level adapter checks (Ruby/Python/PHP/Java/Go)

Protocol drift risk:
- Low; risk is implementation divergence, mitigated with matrix + tests.

## 4. Reverse Proxy Hardening

Required file changes:
- [docker/gateway/server.js](/home/colt/Software/valuya-guard/docker/gateway/server.js)
- [docker/gateway/Dockerfile](/home/colt/Software/valuya-guard/docker/gateway/Dockerfile)
- [docs/reverse-proxy.md](/home/colt/Software/valuya-guard/docs/reverse-proxy.md)
- Templates in `packages/reverse-proxy/templates/*`

New files required:
- None

CI updates required:
- Build gateway image on every PR

Protocol drift risk:
- None; proxy enforces canonical backend result.

## 5. Documentation Polish

Required file changes:
- [README.md](/home/colt/Software/valuya-guard/README.md)
- [docs/README.md](/home/colt/Software/valuya-guard/docs/README.md)
- [docs/choose-your-path.md](/home/colt/Software/valuya-guard/docs/choose-your-path.md)
- [docs/which-package.md](/home/colt/Software/valuya-guard/docs/which-package.md)

New files required:
- [docs/openapi.md](/home/colt/Software/valuya-guard/docs/openapi.md)
- [docs/performance-considerations.md](/home/colt/Software/valuya-guard/docs/performance-considerations.md)
- [docs/observability.md](/home/colt/Software/valuya-guard/docs/observability.md)

CI updates required:
- Markdown lint step

Protocol drift risk:
- None.

## 6. CI/CD Enforcement

Required file changes:
- [.github/workflows/ci.yml](/home/colt/Software/valuya-guard/.github/workflows/ci.yml)
- [package.json](/home/colt/Software/valuya-guard/package.json)

New files required:
- [scripts/ci/lint-markdown.sh](/home/colt/Software/valuya-guard/scripts/ci/lint-markdown.sh)

CI updates required:
- Fail on lint/openapi/contract/adapters/gateway errors

Protocol drift risk:
- Low; CI prevents drift from merging.

## 7. Security Model Clarity

Required file changes:
- [docs/security-model.md](/home/colt/Software/valuya-guard/docs/security-model.md)
- [SECURITY.md](/home/colt/Software/valuya-guard/SECURITY.md)

New files required:
- None

CI updates required:
- None

Protocol drift risk:
- None.

## 8. Packaging Clarity

Required file changes:
- [docs/packaging.md](/home/colt/Software/valuya-guard/docs/packaging.md)
- Root + package READMEs with install commands

New files required:
- None

CI updates required:
- Example/package presence checks

Protocol drift risk:
- None.

## 9. Observability

Required file changes:
- [docs/observability.md](/home/colt/Software/valuya-guard/docs/observability.md)
- [docker/gateway/server.js](/home/colt/Software/valuya-guard/docker/gateway/server.js)

New files required:
- None

CI updates required:
- Keep contract tests + gateway build required

Protocol drift risk:
- None.
