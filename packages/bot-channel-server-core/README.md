# @valuya/bot-channel-server-core

Shared server/bootstrap helpers for gated bot-channel packages.

This package is intentionally small and transport-neutral. It provides:

- env helpers
- request body / path helpers
- internal JSON message endpoint handling
- OpenAI Responses API runner for schema-driven souls

Channel packages keep only their transport-specific webhook/polling glue on top.
