import test from "node:test"
import assert from "node:assert/strict"
import { WhatsAppBotAgentApp } from "./WhatsAppBotAgentApp.js"
import { InMemoryConversationStore } from "../testing/InMemoryConversationStore.js"
import { StaticToolRegistry } from "../testing/StaticToolRegistry.js"

test("agent app executes requested tools and returns the final assistant reply", async () => {
  const store = new InMemoryConversationStore()
  let toolExecuted = false
  const app = new WhatsAppBotAgentApp({
    conversationStore: store,
    linkResolver: {
      async ensureLinked() {
        return {
          allowed: true as const,
          subject: { protocolSubjectHeader: "app_user:123" },
        }
      },
      async redeemLinkToken() {
        throw new Error("should_not_redeem")
      },
    },
    toolRegistry: new StaticToolRegistry(
      () => [{ name: "lookup_cart", description: "Loads the active cart." }],
      async ({ call }) => {
        toolExecuted = true
        return {
          toolCallId: call.id,
          name: call.name,
          output: { items: [{ sku: "alfies-1", qty: 2 }] },
        }
      },
    ),
    agentRuntime: {
      async runTurn({ session }) {
        const hasToolResult = session.entries.some((entry) => entry.role === "tool")
        if (!hasToolResult) {
          return {
            toolCalls: [{ id: "tc_1", name: "lookup_cart", input: {} }],
          }
        }
        return {
          reply: "Ich habe deinen Warenkorb geladen und kann jetzt den Checkout vorbereiten.",
        }
      },
    },
  })

  const result = await app.handleInboundMessage({
    whatsappUserId: "49123456789",
    body: "Zeig mir meinen Warenkorb",
  })

  assert.equal(toolExecuted, true)
  assert.match(result.reply, /Warenkorb/)
  assert.equal(result.linkedSubject?.protocolSubjectHeader, "app_user:123")
})

test("agent app returns the link resolver reply when the user is not linked", async () => {
  const app = new WhatsAppBotAgentApp({
    conversationStore: new InMemoryConversationStore(),
    linkResolver: {
      async ensureLinked() {
        return {
          allowed: false as const,
          code: "not_linked",
          reply: "Bitte verknuepfe zuerst dein Konto.",
        }
      },
      async redeemLinkToken() {
        throw new Error("should_not_redeem")
      },
    },
    toolRegistry: new StaticToolRegistry(() => [], async () => {
      throw new Error("should_not_execute")
    }),
    agentRuntime: {
      async runTurn() {
        throw new Error("should_not_run")
      },
    },
  })

  const result = await app.handleInboundMessage({
    whatsappUserId: "49123456789",
    body: "Ich will bestellen",
  })

  assert.equal(result.reply, "Bitte verknuepfe zuerst dein Konto.")
  assert.equal(result.metadata?.code, "not_linked")
})

test("agent app truncates overly long WhatsApp replies safely", async () => {
  const longReply = [
    "Welche Produkte passen am besten zu 'bier'?",
    ...Array.from({ length: 120 }, (_, index) => `${index + 1}. Beispiel Bier ${index + 1} (1,99 €)`),
  ].join("\n")

  const app = new WhatsAppBotAgentApp({
    conversationStore: new InMemoryConversationStore(),
    linkResolver: {
      async ensureLinked() {
        return {
          allowed: true as const,
          subject: { protocolSubjectHeader: "app_user:123" },
        }
      },
      async redeemLinkToken() {
        throw new Error("should_not_redeem")
      },
    },
    toolRegistry: new StaticToolRegistry(() => [], async () => {
      throw new Error("should_not_execute")
    }),
    agentRuntime: {
      async runTurn() {
        return {
          reply: longReply,
        }
      },
    },
  })

  const result = await app.handleInboundMessage({
    whatsappUserId: "49123456789",
    body: "Zeige mir alle Biersorten",
  })

  assert.ok(result.reply.length <= 1500)
  assert.match(result.reply, /Liste gekuerzt/)
})

test("agent app redeems LINK messages before the shopping runtime runs", async () => {
  let ensureCalled = false
  let runtimeCalled = false
  const app = new WhatsAppBotAgentApp({
    conversationStore: new InMemoryConversationStore(),
    linkResolver: {
      async ensureLinked() {
        ensureCalled = true
        return {
          allowed: true as const,
          subject: { protocolSubjectHeader: "app_user:123" },
        }
      },
      async redeemLinkToken() {
        return {
          linked: true,
          reply: "Konto erfolgreich verknuepft.",
        }
      },
    },
    toolRegistry: new StaticToolRegistry(() => [], async () => {
      throw new Error("should_not_execute")
    }),
    agentRuntime: {
      async runTurn() {
        runtimeCalled = true
        return {
          reply: "should_not_run",
        }
      },
    },
  })

  const result = await app.handleInboundMessage({
    whatsappUserId: "49123456789",
    body: "LINK gls_valid_1",
  })

  assert.equal(ensureCalled, false)
  assert.equal(runtimeCalled, false)
  assert.match(result.reply, /Konto erfolgreich verknuepft/)
  assert.equal(result.metadata?.linkAttempt, true)
  assert.equal(result.metadata?.linked, true)
})
