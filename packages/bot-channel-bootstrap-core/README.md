# @valuya/bot-channel-bootstrap-core

Shared bootstrap helpers for gated bot-channel packages.

This package keeps small but repeated startup concerns in one place:

- normalizing `human` vs `agent` mode
- applying optional soul prompt/schema overrides from env
- creating optional OpenAI-backed soul runtimes

It sits above the app/server core packages and below transport-specific servers.
