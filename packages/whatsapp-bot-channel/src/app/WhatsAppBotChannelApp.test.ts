import test from "node:test"
import assert from "node:assert/strict"
import { WhatsAppBotChannelApp } from "./WhatsAppBotChannelApp.js"

test("app redeems LINK tokens before delegating to the channel runtime", async () => {
  const calls: string[] = []
  const app = new WhatsAppBotChannelApp({
    linkResolver: {
      async redeemLinkToken() {
        calls.push("redeem")
        return {
          linked: true,
          reply: "linked",
        }
      },
    } as any,
    channel: {
      async handleMessage() {
        calls.push("channel")
        return {
          kind: "human",
          reply: "should not happen",
        }
      },
    } as any,
  })

  const result = await app.handleInboundMessage({
    whatsappUserId: "49123",
    body: "LINK gls_abc123",
  })

  assert.equal(result.reply, "linked")
  assert.deepEqual(calls, ["redeem"])
})

test("app delegates normal messages to the channel runtime", async () => {
  const app = new WhatsAppBotChannelApp({
    linkResolver: {
      async redeemLinkToken() {
        throw new Error("should_not_redeem")
      },
    } as any,
    channel: {
      async handleMessage() {
        return {
          kind: "agent",
          soulId: "mentor",
          reply: "Hallo, erzaehl mir mehr.",
        }
      },
    } as any,
  })

  const result = await app.handleInboundMessage({
    whatsappUserId: "49123",
    body: "Ich fuehle mich ueberfordert",
  })

  assert.equal(result.reply, "Hallo, erzaehl mir mehr.")
  assert.equal(result.metadata?.kind, "agent")
  assert.equal(result.metadata?.soulId, "mentor")
})
