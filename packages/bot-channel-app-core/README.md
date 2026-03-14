# @valuya/bot-channel-app-core

Shared inbound app helpers for gated bot-channel packages.

This package keeps channel-agnostic message-entry logic in one place:

- optional link-token interception before runtime handling
- generic inbound app orchestration
- reusable token extractors for common channel onboarding patterns

Transport-specific packages such as `@valuya/whatsapp-bot-channel` and
`@valuya/telegram-bot-channel` keep only their channel-specific wiring on top.
