# Changelog

## Unreleased

### Added
- `@valuya/nestjs`: NestJS middleware adapter for payment-aware authorization.
- `@valuya/nextjs`: Next.js route handler wrapper for entitlement-first access checks.
- `@valuya/hono`: Hono middleware adapter for edge/runtime-portable apps.
- `valuya-django`: Django middleware adapter for payment-aware authorization.

### Release Notes Entries
- New framework adapters now available for NestJS, Next.js, Hono, and Django.
- All four adapters follow the same Valuya Guard flow: entitlements check, checkout session creation on denial, then `402 payment_required` or redirect for HTML clients.
