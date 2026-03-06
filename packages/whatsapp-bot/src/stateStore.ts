import { mkdir, readFile, writeFile } from "node:fs/promises"
import { dirname } from "node:path"

export type CartState = {
  items?: unknown[]
  total_cents?: number
  currency?: string
}

export type RecipeState = {
  title?: string
}

export type ConversationState = {
  subjectId: string
  orderId: string
  lastRecipe?: RecipeState
  lastCart?: CartState
  updatedAt: string
}

type PersistedState = {
  conversations: Record<string, ConversationState>
}

export class FileStateStore {
  private readonly filePath: string

  constructor(filePath: string) {
    this.filePath = filePath
  }

  async get(subjectId: string): Promise<ConversationState | null> {
    const state = await this.readAll()
    return state.conversations[subjectId] ?? null
  }

  async upsert(subjectId: string, patch: Partial<ConversationState>): Promise<ConversationState> {
    const state = await this.readAll()
    const current = state.conversations[subjectId]
    const merged: ConversationState = {
      subjectId,
      orderId: patch.orderId ?? current?.orderId ?? "",
      lastRecipe: patch.lastRecipe ?? current?.lastRecipe,
      lastCart: patch.lastCart ?? current?.lastCart,
      updatedAt: new Date().toISOString(),
    }

    if (!merged.orderId.trim()) {
      throw new Error("state_order_id_required")
    }

    state.conversations[subjectId] = merged
    await this.writeAll(state)
    return merged
  }

  async delete(subjectId: string): Promise<void> {
    const state = await this.readAll()
    if (state.conversations[subjectId]) {
      delete state.conversations[subjectId]
      await this.writeAll(state)
    }
  }

  private async readAll(): Promise<PersistedState> {
    try {
      const raw = await readFile(this.filePath, "utf8")
      const parsed = JSON.parse(raw) as PersistedState
      return {
        conversations: parsed?.conversations ?? {},
      }
    } catch {
      return { conversations: {} }
    }
  }

  private async writeAll(state: PersistedState): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true })
    await writeFile(this.filePath, JSON.stringify(state, null, 2), "utf8")
  }
}

export function normalizeCart(input: unknown): CartState | undefined {
  if (!input || typeof input !== "object") return undefined
  const obj = input as Record<string, unknown>

  const cart: CartState = {}
  if (Array.isArray(obj.items)) cart.items = obj.items

  const total = toInt(obj.total_cents)
  if (typeof total === "number") cart.total_cents = total

  const currency = String(obj.currency ?? "").trim()
  if (currency) cart.currency = currency

  return Object.keys(cart).length > 0 ? cart : undefined
}

export function normalizeRecipe(input: unknown): RecipeState | undefined {
  if (!input || typeof input !== "object") return undefined
  const title = String((input as Record<string, unknown>).title ?? "").trim()
  return title ? { title } : undefined
}

function toInt(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return Math.trunc(value)
  if (typeof value === "string" && value.trim()) {
    const n = Number(value)
    if (Number.isFinite(n)) return Math.trunc(n)
  }
  return undefined
}
