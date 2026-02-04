import type { AgentConfig, SessionStatusResponse } from "./types.js"
import { getSessionStatus } from "./client.js"

export async function waitForPaid(args: {
  cfg: AgentConfig
  sessionId: string
  intervalMs?: number
  timeoutMs?: number
}): Promise<SessionStatusResponse> {
  const interval = args.intervalMs ?? 2000
  const timeout = args.timeoutMs ?? 120000
  const start = Date.now()

  while (true) {
    const s = await getSessionStatus({
      cfg: args.cfg,
      sessionId: args.sessionId,
    })
    if (s.status === "paid") return s
    if (
      s.status === "failed" ||
      s.status === "expired" ||
      s.status === "cancelled"
    )
      return s
    if (Date.now() - start > timeout) return s
    await new Promise((r) => setTimeout(r, interval))
  }
}
