/*import type { Command } from "commander"
import { waitForPaid } from "@valuya/agent"

export function cmdWait(program: Command) {
  program
    .command("wait")
    .requiredOption("--base <url>")
    .requiredOption("--session-id <id>")
    .option("--interval-ms <n>", "poll interval", "2000")
    .option("--timeout-ms <n>", "timeout", "120000")
    .action(async (opts) => {
      const res = await waitForPaid({
        cfg: { base: opts.base },
        sessionId: opts.sessionId,
        intervalMs: Number(opts.intervalMs),
        timeoutMs: Number(opts.timeoutMs),
      })
      console.log(JSON.stringify(res, null, 2))
      process.exit(res.status === "paid" ? 0 : 2)
    })
}*/
