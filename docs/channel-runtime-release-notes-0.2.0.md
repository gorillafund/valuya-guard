# Channel Runtime Release Notes 0.2.0

Published with npm tag:

- `next`

## Published packages

- `@valuya/bot-channel-core@0.2.0`
- `@valuya/bot-channel-app-core@0.2.0`
- `@valuya/bot-channel-server-core@0.2.0`
- `@valuya/bot-channel-bootstrap-core@0.2.0`
- `@valuya/whatsapp-channel-access@0.2.0`
- `@valuya/telegram-channel-access@0.2.0`
- `@valuya/whatsapp-bot-channel@0.2.0`
- `@valuya/telegram-bot-channel@0.2.0`

Already current and therefore skipped:

- `@valuya/channel-access-core`

## Main additions

### External runtime backends

Agent-mode gated channels can now use:

- OpenAI directly
- webhook/API runtimes
- `n8n`
- LangChain-style runtimes
- Python runtimes

This makes the channel packages transport and Guard shells rather than AI-provider-specific apps.

Source of truth:

- [external-soul-runtime-webhook-contract.md](/home/colt/Software/valuya-guard/docs/external-soul-runtime-webhook-contract.md)
- [choose-bot-channel-runtime-backend.md](/home/colt/Software/valuya-guard/docs/choose-bot-channel-runtime-backend.md)

### Runnable reference runtimes

Added:

- local Node demo runtime:
  - [external-soul-runtime-demo.ts](/home/colt/Software/valuya-guard/scripts/external-soul-runtime-demo.ts)
- LangChain-style Node reference:
  - [langchain-runtime-reference.ts](/home/colt/Software/valuya-guard/scripts/langchain-runtime-reference.ts)
- Python reference runtime:
  - [python_soul_runtime_reference.py](/home/colt/Software/valuya-guard/scripts/python_soul_runtime_reference.py)
- importable `n8n` flow:
  - [n8n-valuya-bot-channel-runtime.json](/home/colt/Software/valuya-guard/docs/examples/n8n-valuya-bot-channel-runtime.json)

### Operational tooling

Added:

- `pnpm gated-channel:doctor`
- `pnpm validate:gated-channels`

This makes it easier to:

- validate env files before launch
- prevent preset/example drift in CI

### WhatsApp runtime improvements

Added:

- async thinking-state replies
- outbound follow-up while the agent is still working
- richer runtime decision logs
- stronger soul matching behavior
- built-in `.env` loading

## Operator docs

Added:

- [gated-channel-starter-template.md](/home/colt/Software/valuya-guard/docs/gated-channel-starter-template.md)
- [gated-channel-demo-presets.md](/home/colt/Software/valuya-guard/docs/gated-channel-demo-presets.md)
- [n8n-bot-channel-runtime-guide.md](/home/colt/Software/valuya-guard/docs/n8n-bot-channel-runtime-guide.md)
- [langchain-bot-channel-runtime-guide.md](/home/colt/Software/valuya-guard/docs/langchain-bot-channel-runtime-guide.md)
- [python-bot-channel-runtime-guide.md](/home/colt/Software/valuya-guard/docs/python-bot-channel-runtime-guide.md)

## Recommended next steps

1. Use the runtime chooser to select:
   - OpenAI
   - `n8n`
   - LangChain
   - Python/API
2. Validate the env before launch:
   - `pnpm gated-channel:doctor --env <path> --channel whatsapp|telegram`
3. Keep CI validation on:
   - `pnpm validate:gated-channels`
4. If needed, prepare a small follow-up release note for internal teams using the examples above.
