import test from "node:test"
import assert from "node:assert/strict"
import {
  BotChannelApp,
  extractLinkCommandToken,
  extractTelegramStartToken,
} from "./index.js"

test("BotChannelApp redeems intercepted link tokens before delegating to the channel", async () => {
  const calls: string[] = []
  type InboundArgs = {
    userId: string
    body: string
  }
  const app = new BotChannelApp({
    channel: {
      async handleMessage() {
        calls.push("channel")
        return { kind: "human", reply: "nope" }
      },
    },
    linkResolver: {
      async redeemLinkToken(args: { userId: string; linkToken: string }) {
        calls.push(`redeem:${args.userId}:${args.linkToken}`)
        return { linked: true, reply: "linked" }
      },
    },
    extractLinkToken: (args: InboundArgs) => extractLinkCommandToken(args.body),
    buildLinkArgs: (args: InboundArgs, linkToken: string) => ({
      userId: args.userId,
      linkToken,
    }),
    buildChannelArgs: (args: InboundArgs) => args,
    getChannelReply: (result: { reply: string }) => result.reply,
    getLinkMetadata: (result) => ({ linked: result.linked }),
  })

  const result = await app.handleInboundMessage({
    userId: "u1",
    body: "LINK gls_abc123",
  })

  assert.equal(result.reply, "linked")
  assert.deepEqual(result.metadata, { linked: true })
  assert.deepEqual(calls, ["redeem:u1:gls_abc123"])
})

test("BotChannelApp delegates normal messages to the channel runtime", async () => {
  const app = new BotChannelApp({
    channel: {
      async handleMessage(args: { body: string }) {
        return { reply: `echo:${args.body}`, kind: "agent", soulId: "mentor" }
      },
    },
    buildChannelArgs: (args: { body: string }) => args,
    getChannelReply: (result) => result.reply,
    getChannelMetadata: (result) => ({ kind: result.kind, soulId: result.soulId }),
  })

  const result = await app.handleInboundMessage({ body: "hello" })

  assert.equal(result.reply, "echo:hello")
  assert.deepEqual(result.metadata, { kind: "agent", soulId: "mentor" })
})

test("extractLinkCommandToken finds LINK tokens", () => {
  assert.equal(extractLinkCommandToken("LINK gls_abc123"), "gls_abc123")
  assert.equal(extractLinkCommandToken("foo"), null)
})

test("extractTelegramStartToken finds /start tokens", () => {
  assert.equal(extractTelegramStartToken("/start gls_abc123"), "gls_abc123")
  assert.equal(extractTelegramStartToken("/start@mentorbot gls_abc123"), "gls_abc123")
  assert.equal(extractTelegramStartToken("LINK gls_abc123"), null)
})
