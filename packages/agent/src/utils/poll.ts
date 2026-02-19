// packages/agent/src/utils/poll.ts

export async function pollUntil<T>(args: {
  fn: () => Promise<T>
  isDone: (result: T) => boolean
  intervalMs: number
  timeoutMs: number
}): Promise<T> {
  const started = Date.now()

  while (true) {
    const res = await args.fn()
    if (args.isDone(res)) return res

    if (Date.now() - started > args.timeoutMs) {
      throw new Error("poll_timeout")
    }

    await new Promise((r) => setTimeout(r, args.intervalMs))
  }
}
