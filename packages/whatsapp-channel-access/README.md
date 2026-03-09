# @valuya/whatsapp-channel-access

Reusable entitlement check for paid WhatsApp channel access backed by Valuya Guard.

## What it does

- Resolves whether a WhatsApp user is linked to a Guard subject
- Calls `GET /api/v2/entitlements` with the canonical `X-Valuya-Subject-Id` header
- Returns a small access decision object for bot handlers
- Optionally includes a WhatsApp channel invite URL when access is active

## Install

```bash
pnpm add @valuya/whatsapp-channel-access
```

## Usage

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

## Result shape

Allowed:

```ts
{
  allowed: true,
  reason: "entitled",
  protocolSubjectHeader: "user:17",
  resource: "whatsapp:channel:meta:premium_alpha:49123456789",
  plan: "standard",
  channelUrl: "https://chat.whatsapp.com/InviteCode"
}
```

Denied:

```ts
{
  allowed: false,
  reason: "not_linked" | "inactive" | "guard_unavailable",
  protocolSubjectHeader: string | null,
  resource: string,
  plan: string,
  reply: string
}
```

## Notes

- Requires Node.js with built-in `fetch` support
- Publish target in this repo is the public npm registry under the `next` dist-tag
