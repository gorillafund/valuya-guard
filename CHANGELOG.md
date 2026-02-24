# Changelog

## Unreleased

### Added
- `@valuya/nestjs`: NestJS middleware adapter for payment-aware authorization.
- `@valuya/nextjs`: Next.js route handler wrapper for entitlement-first access checks.
- `@valuya/hono`: Hono middleware adapter for edge/runtime-portable apps.
- `valuya-django`: Django middleware adapter for payment-aware authorization.
- `@valuya/telegram-bot`: Telegram payment-gating adapter with prompt helpers.
- `@valuya/discord-bot`: Discord payment-gating adapter with button-ready prompts.
- `@valuya/agentokratia-signer`: Guardian wallet bridge for Valuya agent purchase + invoke flows.

### Release Notes Entries
- New framework adapters now available for NestJS, Next.js, Hono, and Django.
- All four adapters follow the same Valuya Guard flow: entitlements check, checkout session creation on denial, then `402 payment_required` or redirect for HTML clients.
- Added Telegram and Discord bot adapters with payment-prompt UX helpers and starter templates.
- Added Agentokratia Guardian integration scaffold package and template.
