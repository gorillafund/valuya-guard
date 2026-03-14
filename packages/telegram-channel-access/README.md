# @valuya/telegram-channel-access

Reusable Telegram channel access checks for Valuya Guard.

This package mirrors the newer channel-access contract used by `@valuya/whatsapp-channel-access`:

- prefer `POST /api/v2/channel-access/resolve`
- use `GET /api/v2/entitlements` only as conservative fallback
- keep runtime decisions backend-owned
- keep package behavior channel-generic and transport-focused

## Install

```bash
pnpm add @valuya/telegram-channel-access
```

## Usage

```ts
import { TelegramChannelAccessService } from "@valuya/telegram-channel-access"

const access = new TelegramChannelAccessService({
  baseUrl: process.env.VALUYA_BASE_URL!,
  tenantToken: process.env.VALUYA_TENANT_TOKEN!,
  channelResource: "telegram:channel:guarddemobot:premium_alpha",
  channelPlan: "standard",
  channelInviteUrl: "https://t.me/+premiumInvite",
  linking: myTelegramLinking,
})

const result = await access.resolveAccess({
  telegramUserId: "123",
  telegramUsername: "ada",
})
```

## Notes

- `X-Valuya-Subject-Id` remains the canonical subject input
- request body channel fields are metadata only
- fallback to entitlements is only for narrow endpoint-unavailable cases
