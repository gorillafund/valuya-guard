# Failure Modes (Fail-Closed)

This document defines required fail-closed behavior across middleware adapters, reverse-proxy mode, and gateway.

## Principle

If guard authorization cannot be verified, access must **not** be silently granted.

## Required Behavior Matrix

| Failure mode | Middleware adapters | Reverse proxy templates | Gateway |
|---|---|---|---|
| Backend timeout | Fail closed (`503` default) | Fail closed via auth backend response | Fail closed (`503` default) |
| Network failure | Fail closed (`503`/framework error) | Fail closed | Fail closed |
| Backend `5xx` | Fail closed | Fail closed | Fail closed |
| Missing subject | Fail closed (subject required) | Fail closed | Fail closed (`subject_required`) |
| Invalid tenant token | Fail closed | Fail closed | Fail closed |
| Malformed headers | Fail closed | Fail closed | Fail closed |
| Expired session | Deny path remains payment-required | Deny path remains payment-required | Deny path remains payment-required |
| Replay attempt | Delegated to backend verification and rejected | Delegated | Delegated |

## Canonical deny responses

- HTML/web: `302` redirect to `payment_url`
- API/JSON: `402` with canonical payment payload

## Outage response

When guard backend is unavailable:

- return `503` by default (`VALUYA_FAIL_CLOSED_STATUS` can override in gateway)
- include machine-readable error
- never fallback to implicit allow

## Tracing and diagnostics

- propagate `X-Request-Id` when available
- include request/resource/subject/session identifiers in structured logs
- redact secrets and tokens in logs
