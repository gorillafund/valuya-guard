import test from "node:test"
import assert from "node:assert/strict"
import { TelegramBotChannelApp } from "./TelegramBotChannelApp.js"

test("app redeems /start link tokens before delegating to the channel runtime", async () => {
  const calls: string[] = []
  const app = new TelegramBotChannelApp({
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
    telegramUserId: "12345",
    body: "/start gls_abc123",
  })

  assert.equal(result.reply, "linked")
  assert.deepEqual(calls, ["redeem"])
})

test("app delegates normal Telegram messages to the channel runtime", async () => {
  const app = new TelegramBotChannelApp({
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
          reply: "Erzaehl mir mehr darueber.",
        }
      },
    } as any,
  })

  const result = await app.handleInboundMessage({
    telegramUserId: "12345",
    body: "Ich weiss nicht weiter",
  })

  assert.equal(result.reply, "Erzaehl mir mehr darueber.")
  assert.equal(result.metadata?.kind, "agent")
  assert.equal(result.metadata?.soulId, "mentor")
})
