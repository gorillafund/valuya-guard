import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import assert from "node:assert/strict"
import { GuardWhatsAppLinkService, extractLinkToken } from "./channelLinking.js"
import { FileStateStore } from "./stateStore.js"

type MockResponse = {
  status: number
  body: unknown
}

test("successful redeem persists linked channel record", async () => {
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
            channel_app_id: "whatsapp_main",
            channel_user_id: "49123456789",
            subject_id: 55,
            subject: {
              type: "privy_user",
              external_id: "did:privy:abc123",
            },
            privy_user_id: "did:privy:abc123",
            wallet_address: "0x563eFeff9fb7D6FD0243E5b9Cf620690b69058A7",
            privy_wallet_id: "wa_123",
            protocol_subject: {
              type: "user",
              id: "10",
              header: "user:10",
            },
          },
        },
      },
    ],
    async ({ service, stateStore }) => {
      const result = await service.redeemLinkToken({
        whatsappUserId: "49123456789",
        linkToken: "gls_valid_1",
        whatsappProfileName: "Alice",
      })

      assert.equal(result.linked, true)
      if (!result.linked) return
      assert.equal(result.subject.type, "user")
      assert.equal(result.subject.externalId, "10")
      assert.equal(result.subject.protocolSubjectHeader, "user:10")
      assert.equal(result.subject.guardSubjectId, "55")
      assert.equal(result.subject.linkedWalletAddress, "0x563efeff9fb7d6fd0243e5b9cf620690b69058a7")

      const stored = await stateStore.getChannelLink("49123456789")
      assert.ok(stored)
      assert.equal(stored?.whatsapp_profile_name, "Alice")
      assert.equal(stored?.tenant_id, "1")
      assert.equal(stored?.valuya_subject_id, "55")
      assert.equal(stored?.valuya_subject_type, "privy_user")
      assert.equal(stored?.valuya_subject_external_id, "did:privy:abc123")
      assert.equal(stored?.valuya_linked_wallet_address, "0x563efeff9fb7d6fd0243e5b9cf620690b69058a7")
      assert.equal(stored?.valuya_privy_wallet_id, "wa_123")
      assert.equal(stored?.valuya_protocol_subject_type, "user")
      assert.equal(stored?.valuya_protocol_subject_id, "10")
      assert.equal(stored?.valuya_protocol_subject_header, "user:10")
      assert.equal(stored?.status, "linked")
    },
  )
})

test("extractLinkToken accepts common WhatsApp onboarding message shapes", () => {
  assert.equal(extractLinkToken("LINK gls_valid_1"), "gls_valid_1")
  assert.equal(extractLinkToken("gls_valid_1"), "gls_valid_1")
  assert.equal(
    extractLinkToken("Open this onboarding link: https://example.com/onboarding?token=gls_valid_1"),
    "gls_valid_1",
  )
})

test("guard timeout returns guard_unavailable instead of hanging", async () => {
  const dir = await mkdtemp(join(tmpdir(), "whatsapp-link-timeout-"))
  const stateStore = new FileStateStore(join(dir, "state.json"))
  const service = new GuardWhatsAppLinkService({
    baseUrl: "https://guard.example",
    tenantToken: "ttok_test",
    channelAppId: "whatsapp_main",
    stateStore,
    requestTimeoutMs: 5,
  })

  const originalFetch = globalThis.fetch
  globalThis.fetch = async (_input: URL | RequestInfo, init?: RequestInit): Promise<Response> => {
    const signal = init?.signal
    await new Promise<void>((_resolve, reject) => {
      if (!signal) return
      if (signal.aborted) {
        reject(abortError())
        return
      }
      signal.addEventListener("abort", () => reject(abortError()), { once: true })
    })
    throw abortError()
  }

  try {
    const result = await service.redeemLinkToken({
      whatsappUserId: "49123456789",
      linkToken: "gls_valid_1",
    })

    assert.equal(result.linked, false)
    if (result.linked) return
    assert.equal(result.code, "guard_unavailable")
    assert.match(result.message, /timeout_after_5ms/)
  } finally {
    globalThis.fetch = originalFetch
    await rm(dir, { recursive: true, force: true })
  }
})

test("redeem and resolve both send whatsapp channel app id", async () => {
  const dir = await mkdtemp(join(tmpdir(), "whatsapp-link-appid-"))
  const stateStore = new FileStateStore(join(dir, "state.json"))
  const service = new GuardWhatsAppLinkService({
    baseUrl: "https://guard.example",
    tenantToken: "ttok_test",
    channelAppId: "whatsapp_main",
    stateStore,
  })

  const originalFetch = globalThis.fetch
  const bodies: Array<Record<string, unknown>> = []
  const responses: MockResponse[] = [
    { status: 409, body: { ok: false, error: "link_token_already_used" } },
    {
      status: 200,
      body: {
        ok: true,
        link: {
          status: "linked",
          tenant_id: 1,
          channel_app_id: "whatsapp_main",
          channel_user_id: "49123456789",
          subject_id: 55,
          subject: {
            type: "privy_user",
            external_id: "did:privy:abc123",
          },
          privy_user_id: "did:privy:abc123",
          wallet_address: "0x563eFeff9fb7D6FD0243E5b9Cf620690b69058A7",
          privy_wallet_id: "wa_123",
          protocol_subject: {
            type: "user",
            id: "10",
            header: "user:10",
          },
        },
      },
    },
  ]
  let idx = 0

  globalThis.fetch = async (_input: URL | RequestInfo, init?: RequestInit): Promise<Response> => {
    bodies.push(JSON.parse(String(init?.body || "{}")) as Record<string, unknown>)
    const response = responses[idx++]
    if (!response) throw new Error("unexpected_fetch_call")
    return new Response(JSON.stringify(response.body), {
      status: response.status,
      headers: { "Content-Type": "application/json" },
    })
  }

  try {
    const result = await service.redeemLinkToken({
      whatsappUserId: "49123456789",
      linkToken: "gls_used",
    })

    assert.equal(result.linked, true)
    assert.equal(bodies[0].channel_app_id, "whatsapp_main")
    assert.equal(bodies[1].channel_app_id, "whatsapp_main")
  } finally {
    globalThis.fetch = originalFetch
    await rm(dir, { recursive: true, force: true })
  }
})

test("invalid token returns invalid_token", async () => {
  await withTestService(
    [{ status: 400, body: { ok: false, error: "invalid_link_token" } }],
    async ({ service }) => {
      const result = await service.redeemLinkToken({
        whatsappUserId: "49123456789",
        linkToken: "gls_bad",
      })
      assert.equal(result.linked, false)
      if (result.linked) return
      assert.equal(result.code, "invalid_token")
    },
  )
})

test("expired token returns token_expired", async () => {
  await withTestService(
    [{ status: 410, body: { ok: false, error: "link_token_expired" } }],
    async ({ service }) => {
      const result = await service.redeemLinkToken({
        whatsappUserId: "49123456789",
        linkToken: "gls_expired",
      })
      assert.equal(result.linked, false)
      if (result.linked) return
      assert.equal(result.code, "token_expired")
    },
  )
})

test("tenant mismatch returns tenant_mismatch with clear message", async () => {
  await withTestService(
    [{ status: 403, body: { ok: false, code: "tenant_mismatch", message: "Link token tenant does not match authenticated tenant." } }],
    async ({ service }) => {
      const result = await service.redeemLinkToken({
        whatsappUserId: "49123456789",
        linkToken: "gls_wrong_tenant",
      })
      assert.equal(result.linked, false)
      if (result.linked) return
      assert.equal(result.code, "tenant_mismatch")
      assert.match(result.message, /anderen Tenant|neuen Link/i)
    },
  )
})

test("already-used token is idempotent via resolve fallback", async () => {
  await withTestService(
    [
      { status: 409, body: { ok: false, error: "link_token_already_used" } },
      {
        status: 200,
        body: {
          ok: true,
          link: {
            status: "linked",
            tenant_id: 1,
            channel_app_id: "whatsapp_main",
            channel_user_id: "49123456789",
            subject_id: 55,
            subject: {
              type: "privy_user",
              external_id: "did:privy:abc123",
            },
            privy_user_id: "did:privy:abc123",
            wallet_address: "0x563eFeff9fb7D6FD0243E5b9Cf620690b69058A7",
            privy_wallet_id: "wa_123",
            protocol_subject: {
              type: "user",
              id: "10",
              header: "user:10",
            },
          },
        },
      },
    ],
    async ({ service }) => {
      const result = await service.redeemLinkToken({
        whatsappUserId: "49123456789",
        linkToken: "gls_used",
      })
      assert.equal(result.linked, true)
      if (!result.linked) return
      assert.equal(result.source, "resolve_after_redeem_failure")
    },
  )
})

test("unlinked user is blocked for payment-capable actions", async () => {
  await withTestService(
    [{ status: 404, body: { ok: false, error: "not_linked" } }],
    async ({ service }) => {
      const result = await service.ensureLinkedForPaymentAction({ whatsappUserId: "49123456789" })
      assert.equal(result.allowed, false)
      if (result.allowed) return
      assert.equal(result.code, "not_linked")
      assert.match(result.reply, /LINK gls_/)
    },
  )
})

test("linked user resolves to Valuya subject", async () => {
  await withTestService(
    [
      {
        status: 200,
        body: {
          ok: true,
          link: {
            status: "linked",
            tenant_id: 1,
            channel_app_id: "whatsapp_main",
            channel_user_id: "49123456789",
            subject_id: 77,
            subject: {
              type: "privy_user",
              external_id: "did:privy:linked-user",
            },
            privy_user_id: "did:privy:linked-user",
            wallet_address: "0x563eFeff9fb7D6FD0243E5b9Cf620690b69058A7",
            privy_wallet_id: "wa_123",
            protocol_subject: {
              type: "user",
              id: "17",
              header: "user:17",
            },
          },
        },
      },
    ],
    async ({ service }) => {
      const result = await service.ensureLinkedForPaymentAction({ whatsappUserId: "49123456789" })
      assert.equal(result.allowed, true)
      if (!result.allowed) return
      assert.equal(result.subject.type, "user")
      assert.equal(result.subject.externalId, "17")
      assert.equal(result.subject.protocolSubjectHeader, "user:17")
      assert.equal(result.subject.guardSubjectId, "77")
      assert.equal(result.subject.guardSubjectType, "privy_user")
      assert.equal(result.subject.guardSubjectExternalId, "did:privy:linked-user")
    },
  )
})

test("linked response missing wallet_address fails safely", async () => {
  await withTestService(
    [
      {
        status: 200,
        body: {
          ok: true,
          link: {
            status: "linked",
            tenant_id: 1,
            channel_app_id: "whatsapp_main",
            channel_user_id: "49123456789",
            subject_id: 77,
            subject: {
              type: "privy_user",
              external_id: "did:privy:linked-user",
            },
            privy_user_id: "did:privy:linked-user",
            protocol_subject: {
              type: "user",
              id: "17",
              header: "user:17",
            },
          },
        },
      },
    ],
    async ({ service }) => {
      const result = await service.ensureLinkedForPaymentAction({ whatsappUserId: "49123456789" })
      assert.equal(result.allowed, false)
      if (result.allowed) return
      assert.equal(result.code, "not_linked")
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
            channel_app_id: "whatsapp_main",
            channel_user_id: "49123456789",
            subject_id: 77,
            subject: {
              type: "privy_user",
              external_id: "did:privy:linked-user",
            },
            privy_user_id: "did:privy:linked-user",
            wallet_address: "0x563eFeff9fb7D6FD0243E5b9Cf620690b69058A7",
          },
        },
      },
    ],
    async ({ service }) => {
      const result = await service.ensureLinkedForPaymentAction({ whatsappUserId: "49123456789" })
      assert.equal(result.allowed, false)
      if (result.allowed) return
      assert.equal(result.code, "not_linked")
    },
  )
})

async function withTestService(
  responses: MockResponse[],
  run: (args: { service: GuardWhatsAppLinkService; stateStore: FileStateStore }) => Promise<void>,
): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "whatsapp-linking-test-"))
  const stateStore = new FileStateStore(join(dir, "state.json"))
  const service = new GuardWhatsAppLinkService({
    baseUrl: "https://guard.example",
    tenantToken: "ttok_usage",
    channelAppId: "whatsapp_main",
    stateStore,
  })

  const originalFetch = globalThis.fetch
  let callIndex = 0
  globalThis.fetch = async () => {
    const response = responses[callIndex++]
    if (!response) {
      throw new Error("unexpected_fetch_call")
    }

    return new Response(JSON.stringify(response.body), {
      status: response.status,
      headers: { "Content-Type": "application/json" },
    })
  }

  try {
    await run({ service, stateStore })
    assert.equal(callIndex, responses.length)
  } finally {
    globalThis.fetch = originalFetch
    await rm(dir, { recursive: true, force: true })
  }
}

function abortError(): Error {
  const error = new Error("aborted")
  error.name = "AbortError"
  return error
}
