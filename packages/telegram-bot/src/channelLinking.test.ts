import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import assert from "node:assert/strict"
import { GuardTelegramLinkService } from "./channelLinking.js"
import { TelegramLinkStore } from "./linkStore.js"

type MockResponse = {
  status: number
  body: unknown
}

type FetchCall = {
  url: string
  method: string
  body: Record<string, unknown>
}

test("successful redeem followed by deterministic local resolve", async () => {
  await withTestService(
    [
      {
        status: 200,
        body: {
          ok: true,
          link: {
            id: 123,
            status: "linked",
            tenant_id: 1,
            channel_app_id: "telegram_main",
            channel_user_id: "987654321",
            subject_id: 55,
            subject: {
              type: "privy_user",
              external_id: "did:privy:abc123",
            },
            privy_user_id: "did:privy:abc123",
            privy_wallet_id: "wa_123",
            wallet_address: "0x563eFeff9fb7D6FD0243E5b9Cf620690b69058A7",
            protocol_subject: {
              type: "user",
              id: "10",
              header: "user:10",
            },
          },
        },
      },
    ],
    async ({ service, linkStore, fetchCalls }) => {
      const redeemed = await service.redeemLinkToken({
        telegramUserId: "987654321",
        telegramUsername: "alice",
        linkToken: "gls_valid",
      })

      assert.equal(redeemed.linked, true)
      const allowed = await service.ensureLinkedForPaymentAction({
        telegramUserId: "987654321",
      })
      assert.equal(allowed.allowed, true)
      if (allowed.allowed) {
        assert.equal(allowed.subject.type, "user")
        assert.equal(allowed.subject.externalId, "10")
      }
      assert.equal(fetchCalls.length, 1, "ensureLinked should hit local cache right after redeem")

      const stored = await linkStore.getChannelLink("987654321")
      assert.ok(stored)
      assert.equal(stored?.telegram_username, "alice")
      assert.equal(stored?.status, "linked")
      assert.equal(stored?.valuya_privy_wallet_id, "wa_123")
      assert.equal(stored?.valuya_linked_wallet_address, "0x563efeff9fb7d6fd0243e5b9cf620690b69058a7")
      assert.equal(stored?.valuya_protocol_subject_type, "user")
      assert.equal(stored?.valuya_protocol_subject_id, "10")
      assert.equal(stored?.valuya_protocol_subject_header, "user:10")
    },
  )
})

test("mismatch bug prevention: redeem and resolve both use from.id channel_user_id", async () => {
  await withTestService(
    [
      {
        status: 200,
        body: {
          ok: true,
          link: {
            status: "linked",
            tenant_id: 1,
            channel_app_id: "telegram_main",
            channel_user_id: "777888999",
            subject_id: 55,
            subject: { type: "privy_user", external_id: "did:privy:abc123" },
            wallet_address: "0x563eFeff9fb7D6FD0243E5b9Cf620690b69058A7",
            protocol_subject: { type: "user", id: "10", header: "user:10" },
          },
        },
      },
      {
        status: 200,
        body: {
          ok: true,
          link: {
            status: "linked",
            tenant_id: 1,
            channel_app_id: "telegram_main",
            channel_user_id: "777888999",
            subject_id: 55,
            subject: { type: "privy_user", external_id: "did:privy:abc123" },
            wallet_address: "0x563eFeff9fb7D6FD0243E5b9Cf620690b69058A7",
            protocol_subject: { type: "user", id: "10", header: "user:10" },
          },
        },
      },
    ],
    async ({ service, fetchCalls }) => {
      await service.redeemLinkToken({
        telegramUserId: "777888999",
        linkToken: "gls_valid",
      })

      // Force backend resolve path by creating a fresh service/store pair is unnecessary here; call resolve directly.
      await service.resolveLinkedSubject({ telegramUserId: "777888999" })

      assert.equal(fetchCalls.length, 2)
      assert.equal(fetchCalls[0].body.channel_user_id, "777888999")
      assert.equal(fetchCalls[1].body.channel_user_id, "777888999")
    },
  )
})

test("app id consistency: resolve uses configured channel_app_id and never bot username", async () => {
  await withTestService(
    [
      {
        status: 200,
        body: {
          ok: true,
          link: {
            status: "linked",
            tenant_id: 1,
            channel_app_id: "telegram_main",
            channel_user_id: "987654321",
            subject_id: 99,
            subject: { type: "privy_user", external_id: "did:privy:linked-user" },
            wallet_address: "0x563eFeff9fb7D6FD0243E5b9Cf620690b69058A7",
            protocol_subject: { type: "user", id: "10", header: "user:10" },
          },
        },
      },
    ],
    async ({ service, fetchCalls }) => {
      await service.resolveLinkedSubject({
        telegramUserId: "987654321",
        telegramUsername: "GuardDemoBot",
      })

      assert.equal(fetchCalls.length, 1)
      assert.equal(fetchCalls[0].body.channel_user_id, "987654321")
      assert.equal(fetchCalls[0].body.channel_app_id, "telegram_main")
      assert.notEqual(fetchCalls[0].body.channel_app_id, "GuardDemoBot")
      assert.notEqual(fetchCalls[0].body.channel_app_id, "@GuardDemoBot")
    },
  )
})

test("invalid token returns invalid_token", async () => {
  await withTestService(
    [{ status: 400, body: { ok: false, error: "invalid_link_token" } }],
    async ({ service }) => {
      const result = await service.redeemLinkToken({
        telegramUserId: "987654321",
        linkToken: "gls_bad",
      })
      assert.equal(result.linked, false)
      if (!result.linked) assert.equal(result.code, "invalid_token")
    },
  )
})

test("expired/already-used token paths", async () => {
  await withTestService(
    [
      { status: 410, body: { ok: false, error: "link_token_expired" } },
      { status: 409, body: { ok: false, error: "link_token_already_used" } },
      {
        status: 200,
        body: {
          ok: true,
          link: {
            status: "linked",
            tenant_id: 1,
            channel_app_id: "telegram_main",
            channel_user_id: "987654321",
            subject_id: 55,
            subject: { type: "privy_user", external_id: "did:privy:abc123" },
            wallet_address: "0x563eFeff9fb7D6FD0243E5b9Cf620690b69058A7",
            protocol_subject: { type: "user", id: "10", header: "user:10" },
          },
        },
      },
    ],
    async ({ service }) => {
      const expired = await service.redeemLinkToken({ telegramUserId: "987654321", linkToken: "gls_expired" })
      assert.equal(expired.linked, false)
      if (!expired.linked) assert.equal(expired.code, "token_expired")

      const used = await service.redeemLinkToken({ telegramUserId: "987654321", linkToken: "gls_used" })
      assert.equal(used.linked, true)
      if (used.linked) assert.equal(used.source, "resolve_after_redeem_failure")
    },
  )
})

test("tenant mismatch returns tenant_mismatch with clear message", async () => {
  await withTestService(
    [{ status: 403, body: { ok: false, code: "tenant_mismatch", message: "Link token tenant does not match authenticated tenant." } }],
    async ({ service }) => {
      const result = await service.redeemLinkToken({
        telegramUserId: "987654321",
        linkToken: "gls_wrong_tenant",
      })
      assert.equal(result.linked, false)
      if (!result.linked) {
        assert.equal(result.code, "tenant_mismatch")
        assert.match(result.message, /different tenant|new link/i)
      }
    },
  )
})

test("linked response missing protocol_subject fails safely", async () => {
  await withTestService(
    [
      {
        status: 200,
        body: {
          ok: true,
          link: {
            status: "linked",
            tenant_id: 1,
            channel_app_id: "telegram_main",
            channel_user_id: "987654321",
            subject_id: 55,
            subject: { type: "privy_user", external_id: "did:privy:abc123" },
            wallet_address: "0x563eFeff9fb7D6FD0243E5b9Cf620690b69058A7",
          },
        },
      },
    ],
    async ({ service }) => {
      const result = await service.redeemLinkToken({
        telegramUserId: "987654321",
        linkToken: "gls_valid",
      })
      assert.equal(result.linked, false)
      if (!result.linked) assert.equal(result.code, "guard_unavailable")
    },
  )
})

test("redeem success with canonical fields is accepted even if legacy subject fields are missing", async () => {
  await withTestService(
    [
      {
        status: 200,
        body: {
          ok: true,
          link: {
            status: "linked",
            tenant_id: 1,
            channel_app_id: "telegram_main",
            channel_user_id: "987654321",
            wallet_address: "0x563eFeff9fb7D6FD0243E5b9Cf620690b69058A7",
            privy_wallet_id: "wa_123",
            protocol_subject: { type: "user", id: "10", header: "user:10" },
          },
        },
      },
    ],
    async ({ service }) => {
      const result = await service.redeemLinkToken({
        telegramUserId: "987654321",
        linkToken: "gls_valid",
      })
      assert.equal(result.linked, true)
      if (result.linked) {
        assert.equal(result.subject.type, "user")
        assert.equal(result.subject.externalId, "10")
        assert.equal(result.link.valuya_linked_wallet_address, "0x563efeff9fb7d6fd0243e5b9cf620690b69058a7")
      }
    },
  )
})

test("resolve failure after redeem success does not undo local linked state", async () => {
  await withTestService(
    [
      {
        status: 200,
        body: {
          ok: true,
          link: {
            status: "linked",
            tenant_id: 1,
            channel_app_id: "telegram_main",
            channel_user_id: "987654321",
            wallet_address: "0x563eFeff9fb7D6FD0243E5b9Cf620690b69058A7",
            privy_wallet_id: "wa_123",
            protocol_subject: { type: "user", id: "17", header: "user:17" },
          },
        },
      },
      { status: 404, body: { ok: false, error: "link_not_found" } },
    ],
    async ({ service, fetchCalls }) => {
      const redeemed = await service.redeemLinkToken({
        telegramUserId: "987654321",
        linkToken: "gls_valid",
      })
      assert.equal(redeemed.linked, true)

      const resolved = await service.resolveLinkedSubject({
        telegramUserId: "987654321",
      })
      assert.equal(resolved.linked, false)

      const allowed = await service.ensureLinkedForPaymentAction({
        telegramUserId: "987654321",
      })
      assert.equal(allowed.allowed, true)
      assert.equal(fetchCalls.length, 2)
    },
  )
})

test("unlinked user remains blocked", async () => {
  await withTestService(
    [{ status: 404, body: { ok: false, error: "not_linked" } }],
    async ({ service }) => {
      const result = await service.ensureLinkedForPaymentAction({
        telegramUserId: "987654321",
      })
      assert.equal(result.allowed, false)
      if (!result.allowed) {
        assert.equal(result.code, "not_linked")
        assert.match(result.reply, /onboarding link/i)
      }
    },
  )
})

async function withTestService(
  responses: MockResponse[],
  run: (args: {
    service: GuardTelegramLinkService
    linkStore: TelegramLinkStore
    fetchCalls: FetchCall[]
  }) => Promise<void>,
): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "telegram-linking-test-"))
  const linkStore = new TelegramLinkStore(join(dir, "links.json"))
  const service = new GuardTelegramLinkService({
    baseUrl: "https://guard.example",
    tenantToken: "ttok_usage",
    channelAppId: "telegram_main",
    linkStore,
  })

  const fetchCalls: FetchCall[] = []
  const originalFetch = globalThis.fetch
  let callIndex = 0
  globalThis.fetch = async (input, init) => {
    const url = String(input)
    const bodyRaw = String(init?.body || "{}")
    const body = JSON.parse(bodyRaw) as Record<string, unknown>
    fetchCalls.push({
      url,
      method: String(init?.method || "GET"),
      body,
    })

    const response = responses[callIndex++]
    if (!response) throw new Error("unexpected_fetch_call")

    return new Response(JSON.stringify(response.body), {
      status: response.status,
      headers: { "Content-Type": "application/json" },
    })
  }

  try {
    await run({ service, linkStore, fetchCalls })
    assert.equal(callIndex, responses.length)
  } finally {
    globalThis.fetch = originalFetch
    await rm(dir, { recursive: true, force: true })
  }
}
