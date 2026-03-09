import test from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { GuardTelegramLinkService, extractStartLinkToken } from "../dist/telegram-bot/examples/alfies-concierge/channelLinking.js"
import { TelegramLinkStore } from "../dist/telegram-bot/examples/alfies-concierge/linkStore.js"

test("extractStartLinkToken parses /start payload token", () => {
  assert.equal(extractStartLinkToken("/start gls_abc"), "gls_abc")
  assert.equal(extractStartLinkToken("/start@GuardDemoBot gls_xyz"), "gls_xyz")
  assert.equal(extractStartLinkToken("/start"), null)
})

test("redeem then resolve uses stable from.id + configured app id", async () => {
  const responses = [
    {
      status: 200,
      body: {
        ok: true,
        link: {
          status: "linked",
          tenant_id: 1,
          channel_app_id: "telegram_main",
          channel_user_id: "11223344",
          subject_id: 55,
          subject: { type: "privy_user", external_id: "did:privy:abc" },
          privy_wallet_id: "wa_123",
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
          channel_user_id: "11223344",
          subject_id: 55,
          subject: { type: "privy_user", external_id: "did:privy:abc" },
          privy_wallet_id: "wa_123",
          wallet_address: "0x563eFeff9fb7D6FD0243E5b9Cf620690b69058A7",
          protocol_subject: { type: "user", id: "10", header: "user:10" },
        },
      },
    },
  ]

  await withService(responses, async ({ service, fetchCalls, store }) => {
    await service.redeemLinkToken({
      telegramUserId: "11223344",
      telegramUsername: "GuardDemoBot",
      linkToken: "gls_ok",
    })

    await service.resolveLinkedSubject({
      telegramUserId: "11223344",
      telegramUsername: "GuardDemoBot",
    })

    const allowed = await service.ensureLinkedForPaymentAction({
      telegramUserId: "11223344",
    })
    assert.equal(allowed.allowed, true)
    if (allowed.allowed) {
      assert.equal(allowed.subject.type, "user")
      assert.equal(allowed.subject.id, "10")
    }

    const persisted = await store.getChannelLink("11223344")
    assert.equal(
      persisted?.valuya_linked_wallet_address,
      "0x563efeff9fb7d6fd0243e5b9cf620690b69058a7",
    )
    assert.equal(persisted?.valuya_privy_wallet_id, "wa_123")
    assert.equal(persisted?.valuya_protocol_subject_type, "user")
    assert.equal(persisted?.valuya_protocol_subject_id, "10")
    assert.equal(persisted?.valuya_protocol_subject_header, "user:10")

    assert.equal(fetchCalls[0].body.channel_user_id, "11223344")
    assert.equal(fetchCalls[1].body.channel_user_id, "11223344")
    assert.equal(fetchCalls[1].body.channel_app_id, "telegram_main")
    assert.notEqual(fetchCalls[1].body.channel_app_id, "GuardDemoBot")
    assert.notEqual(fetchCalls[1].body.channel_app_id, "@GuardDemoBot")
  })
})

test("linked response missing protocol_subject fails safely", async () => {
  const responses = [
    {
      status: 200,
      body: {
        ok: true,
        link: {
          status: "linked",
          tenant_id: 1,
          channel_app_id: "telegram_main",
          channel_user_id: "11223344",
          subject_id: 55,
          subject: { type: "privy_user", external_id: "did:privy:abc" },
          wallet_address: "0x563eFeff9fb7D6FD0243E5b9Cf620690b69058A7",
        },
      },
    },
  ]

  await withService(responses, async ({ service }) => {
    const result = await service.redeemLinkToken({
      telegramUserId: "11223344",
      telegramUsername: "GuardDemoBot",
      linkToken: "gls_ok",
    })
    assert.equal(result.linked, false)
    if (!result.linked) assert.equal(result.code, "guard_unavailable")
  })
})

test("redeem success with canonical fields is accepted even if legacy subject fields are missing", async () => {
  const responses = [
    {
      status: 200,
      body: {
        ok: true,
        link: {
          status: "linked",
          tenant_id: 1,
          channel_app_id: "telegram_main",
          channel_user_id: "11223344",
          privy_wallet_id: "wa_123",
          wallet_address: "0x563eFeff9fb7D6FD0243E5b9Cf620690b69058A7",
          protocol_subject: { type: "user", id: "10", header: "user:10" },
        },
      },
    },
  ]

  await withService(responses, async ({ service, store }) => {
    const result = await service.redeemLinkToken({
      telegramUserId: "11223344",
      telegramUsername: "GuardDemoBot",
      linkToken: "gls_ok",
    })
    assert.equal(result.linked, true)
    if (result.linked) {
      assert.equal(result.subject.type, "user")
      assert.equal(result.subject.id, "10")
    }
    const persisted = await store.getChannelLink("11223344")
    assert.equal(persisted?.valuya_protocol_subject_header, "user:10")
    assert.equal(
      persisted?.valuya_linked_wallet_address,
      "0x563efeff9fb7d6fd0243e5b9cf620690b69058a7",
    )
  })
})

test("resolve failure after redeem success does not undo local linked state", async () => {
  const responses = [
    {
      status: 200,
      body: {
        ok: true,
        link: {
          status: "linked",
          tenant_id: 1,
          channel_app_id: "telegram_main",
          channel_user_id: "11223344",
          privy_wallet_id: "wa_123",
          wallet_address: "0x563eFeff9fb7D6FD0243E5b9Cf620690b69058A7",
          protocol_subject: { type: "user", id: "17", header: "user:17" },
        },
      },
    },
    { status: 404, body: { ok: false, error: "link_not_found" } },
  ]

  await withService(responses, async ({ service, fetchCalls }) => {
    const redeemed = await service.redeemLinkToken({
      telegramUserId: "11223344",
      telegramUsername: "GuardDemoBot",
      linkToken: "gls_ok",
    })
    assert.equal(redeemed.linked, true)

    const resolved = await service.resolveLinkedSubject({
      telegramUserId: "11223344",
      telegramUsername: "GuardDemoBot",
    })
    assert.equal(resolved.linked, false)

    const allowed = await service.ensureLinkedForPaymentAction({
      telegramUserId: "11223344",
    })
    assert.equal(allowed.allowed, true)
    assert.equal(fetchCalls.length, 2)
  })
})

test("unlinked user stays blocked", async () => {
  await withService([{ status: 404, body: { ok: false, error: "not_linked" } }], async ({ service }) => {
    const result = await service.ensureLinkedForPaymentAction({ telegramUserId: "99999" })
    assert.equal(result.allowed, false)
    if (!result.allowed) {
      assert.equal(result.code, "not_linked")
    }
  })
})

test("tenant mismatch returns tenant_mismatch with clear message", async () => {
  await withService(
    [{ status: 403, body: { ok: false, code: "tenant_mismatch", message: "Link token tenant does not match authenticated tenant." } }],
    async ({ service }) => {
      const result = await service.redeemLinkToken({
        telegramUserId: "11223344",
        telegramUsername: "GuardDemoBot",
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

async function withService(responses, run) {
  const dir = await mkdtemp(join(tmpdir(), "alfies-linking-test-"))
  const store = new TelegramLinkStore(join(dir, "links.json"))
  const service = new GuardTelegramLinkService({
    baseUrl: "https://guard.example",
    tenantToken: "ttok_usage",
    channelAppId: "telegram_main",
    linkStore: store,
  })

  const originalFetch = globalThis.fetch
  const fetchCalls = []
  let idx = 0
  globalThis.fetch = async (input, init) => {
    fetchCalls.push({
      url: String(input),
      body: JSON.parse(String(init?.body || "{}")),
    })
    const next = responses[idx++]
    if (!next) throw new Error("unexpected_fetch_call")
    return new Response(JSON.stringify(next.body), {
      status: next.status,
      headers: { "Content-Type": "application/json" },
    })
  }

  try {
    await run({ service, fetchCalls, store })
    assert.equal(idx, responses.length)
  } finally {
    globalThis.fetch = originalFetch
    await rm(dir, { recursive: true, force: true })
  }
}
