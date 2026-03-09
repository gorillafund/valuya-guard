import test from "node:test"
import assert from "node:assert/strict"
import { ConciergeClient } from "./conciergeClient.js"

test("times out stalled concierge requests", async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (_input: URL | RequestInfo, init?: RequestInit): Promise<Response> => {
    const signal = init?.signal
    await new Promise<void>((resolve, reject) => {
      if (!signal) return
      if (signal.aborted) {
        reject(abortError())
        return
      }
      signal.addEventListener(
        "abort",
        () => {
          reject(abortError())
        },
        { once: true },
      )
    })
    throw abortError()
  }

  try {
    const client = new ConciergeClient({
      webhookUrl: "https://n8n.example/webhook",
      maxRetries: 1,
      requestTimeoutMs: 5,
    })

    await assert.rejects(
      () =>
        client.call({
          action: "recipe",
          orderId: "ord_1",
          message: "Paella",
          subject: { type: "whatsapp", id: "+49123456789" },
        }),
      /concierge_timeout_after_5ms/,
    )
  } finally {
    globalThis.fetch = originalFetch
  }
})

function abortError(): Error {
  const error = new Error("aborted")
  error.name = "AbortError"
  return error
}
