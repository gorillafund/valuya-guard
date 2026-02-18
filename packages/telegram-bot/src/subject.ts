import type { Subject } from "@valuya/core"

/**
 * Canonical subject for Telegram users.
 * IMPORTANT: keep this stable forever or mandates won’t match.
 */
export function telegramSubject(userId: number): Subject {
  return { type: "telegram", id: String(userId) }
}
