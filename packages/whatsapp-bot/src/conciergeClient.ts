import { randomUUID } from "node:crypto"
import type { CartState } from "./stateStore.js"

export type ConciergeAction = "recipe" | "alt" | "confirm" | "cancel" | "status"

export type ConciergeResponse = {
  ok?: boolean
  orderId?: string
  text?: string
  messages?: string[]
  recipe?: { title?: string }
  cart?: { items?: unknown; total_cents?: unknown; currency?: unknown }
  eta?: string
  telegram?: {
    text?: string
  }
  [k: string]: unknown
}

export type ConciergeSubject = {
  type: "whatsapp"
  id: string
}

export type ConciergePayload = {
  action: ConciergeAction
  orderId: string
  message?: string
  cartState?: CartState
  subject: ConciergeSubject
}

export class ConciergeClient {
  private readonly webhookUrl: string
  private readonly maxRetries: number
  private readonly initialBackoffMs: number

  constructor(args: { webhookUrl: string; maxRetries?: number; initialBackoffMs?: number }) {
    this.webhookUrl = args.webhookUrl
    this.maxRetries = args.maxRetries ?? 3
    this.initialBackoffMs = args.initialBackoffMs ?? 300
  }

  async call(payload: ConciergePayload): Promise<ConciergeResponse> {
    const requestId = randomUUID()

    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      try {
        const response = await fetch(this.webhookUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
            "X-Request-Id": requestId,
          },
          body: JSON.stringify(payload),
        })

        const body = await safeParseJson(response)
        if (!response.ok) {
          if (shouldRetryStatus(response.status) && attempt < this.maxRetries) {
            await sleep(this.initialBackoffMs * Math.pow(2, attempt - 1))
            continue
          }
          throw new Error(
            `concierge_http_${response.status}:${JSON.stringify(body).slice(0, 280)}`,
          )
        }

        return body as ConciergeResponse
      } catch (error) {
        if (attempt >= this.maxRetries) throw error
        await sleep(this.initialBackoffMs * Math.pow(2, attempt - 1))
      }
    }

    throw new Error("concierge_unreachable")
  }
}

export function responseText(response: ConciergeResponse): string {
  const fallback = Array.isArray(response.messages) ? response.messages.join("\n") : "Alles klar."
  return String(response.text || response.telegram?.text || fallback).trim() || "Alles klar."
}

async function safeParseJson(response: Response): Promise<unknown> {
  const text = await response.text()
  if (!text) return {}
  try {
    return JSON.parse(text)
  } catch {
    return { raw: text }
  }
}

function shouldRetryStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
