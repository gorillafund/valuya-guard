# @valuya/whatsapp-channel-access

Reusable WhatsApp channel access and runtime primitives for Valuya Guard.

Phase 1 of this package is aimed at gated WhatsApp channels where a merchant can:

- gate channel access through Valuya Guard
- support free-trial or paid access states
- route messages to a human or an agent
- configure an agent "soul" prompt
- keep lightweight conversation memory
- let that soul read from Guard through typed tools

This package is intentionally narrower than `@valuya/whatsapp-bot-agent`. It is for channel access and channel conversations, not Alfies checkout orchestration.

For the preferred backend contract for trial-aware channel access, see [GUARD_CHANNEL_ACCESS_API.md](/home/colt/Software/valuya-guard/packages/whatsapp-channel-access/GUARD_CHANNEL_ACCESS_API.md).

## What it does

- resolves whether a WhatsApp user is linked to a Guard subject
- resolves access state for a WhatsApp channel:
  - `not_linked`
  - `trial_active`
  - `paid_active`
  - `expired_payment_required`
  - `inactive`
  - `guard_unavailable`
- supports a small runtime with:
  - `human` mode
  - `agent` mode
- supports merchant-configured souls
- supports pluggable memory stores
- supports typed Guard read tools for agent use

## Install

```bash
pnpm add @valuya/whatsapp-channel-access
```

## Core exports

```ts
import {
  WhatsAppChannelAccessService,
  WhatsAppChannelRuntime,
  InMemoryMemoryStore,
  OpenAISoulRuntimeAdapter,
  createGuardReadTools,
  buildWhatsAppChannelResource,
} from "@valuya/whatsapp-channel-access"
```

## Access-only usage

```ts
import { WhatsAppChannelAccessService } from "@valuya/whatsapp-channel-access"

const access = new WhatsAppChannelAccessService({
  baseUrl: process.env.VALUYA_BASE_URL!,
  tenantToken: process.env.VALUYA_TENANT_TOKEN!,
  channelResource: "whatsapp:channel:meta:premium_alpha:49123456789",
  channelPlan: "standard",
  channelVisitUrl: "https://chat.whatsapp.com/InviteCode",
  linking: {
    async ensureLinkedForPaymentAction({ whatsappUserId }) {
      const protocolSubjectHeader = await lookupLinkedSubjectHeader(whatsappUserId)
      if (!protocolSubjectHeader) {
        return {
          allowed: false,
          code: "not_linked",
          reply: "Account link required before channel access can be checked.",
        }
      }

      return {
        allowed: true,
        link: {
          valuya_protocol_subject_header: protocolSubjectHeader,
        },
      }
    },
  },
})

const result = await access.resolveAccess({
  whatsappUserId: "49123456789",
  whatsappProfileName: "Ada",
})
```

## Runtime usage

```ts
import {
  InMemoryMemoryStore,
  OpenAISoulRuntimeAdapter,
  WhatsAppChannelAccessService,
  WhatsAppChannelRuntime,
} from "@valuya/whatsapp-channel-access"

const access = new WhatsAppChannelAccessService({
  baseUrl: process.env.VALUYA_BASE_URL!,
  tenantToken: process.env.VALUYA_TENANT_TOKEN!,
  channelResource: "whatsapp:channel:meta:premium_alpha:49123456789",
  channelPlan: "standard",
  linking: myLinkResolver,
})

const mentorSoul = {
  id: "mentor",
  name: "Mentor",
  systemPrompt: "Du bist ein ganzheitlicher Mentor fuer persoenliches Wachstum.",
  locale: "de",
  memoryPolicy: {
    keepRecentTurns: 12,
    summarizeAfterTurns: 20,
  },
  tools: ["guard.get_channel_access_state", "guard.get_entitlements"],
}

const soulRuntime = new OpenAISoulRuntimeAdapter({
  async runCompletion({ system, user }) {
    const reply = await runMyOpenAICompletion(system, user)
    return { reply }
  },
})

const runtime = new WhatsAppChannelRuntime({
  access,
  mode: { kind: "agent", soulId: "mentor" },
  souls: [mentorSoul],
  soulRuntime,
  memoryStore: new InMemoryMemoryStore(),
})

const result = await runtime.handleMessage({
  whatsappUserId: "49123456789",
  body: "Ich fuehle mich gerade orientierungslos.",
  profileName: "Ada",
  locale: "de",
})
```

## Access result shape

Allowed:

```ts
{
  allowed: true,
  state: "trial_active" | "paid_active",
  protocolSubjectHeader: "user:17",
  resource: "whatsapp:channel:meta:premium_alpha:49123456789",
  plan: "standard",
  expiresAt: "2026-03-31T23:59:59Z",
  channelUrl: "https://chat.whatsapp.com/InviteCode"
}
```

Blocked:

```ts
{
  allowed: false,
  state: "not_linked" | "expired_payment_required" | "inactive" | "guard_unavailable",
  protocolSubjectHeader: "user:17" | null,
  resource: "whatsapp:channel:meta:premium_alpha:49123456789",
  plan: "standard",
  reply: "Please complete onboarding first.",
  expiresAt: "2026-03-01T00:00:00Z",
  paymentUrl: "https://pay.example/checkout/ch_123"
}
```

## Runtime result shape

Blocked:

```ts
{ kind: "blocked", reply: "..." }
```

Human:

```ts
{ kind: "human", reply: "Dein Zugang ist aktiv. ..." }
```

Agent:

```ts
{
  kind: "agent",
  soulId: "mentor",
  reply: "Was beschaeftigt dich daran gerade am meisten?"
}
```

## Guard tools

The package includes a helper for typed read-only Guard tools:

```ts
import { createGuardReadTools } from "@valuya/whatsapp-channel-access"

const tools = createGuardReadTools(myGuardToolClient)
```

Current read tool surface:

- `getChannelAccessState`
- `getEntitlements`
- `getRecentOrders`
- `getRecentPayments`

## Notes

- Requires Node.js with built-in `fetch`
- The default access resolver currently uses `GET /api/v2/entitlements`
- Trial-specific behavior depends on backend responses that include states like `trial_active` or `expired_payment_required`
- `OpenAISoulRuntimeAdapter` is only an adapter shape; you provide the actual completion call
