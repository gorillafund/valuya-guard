import type { Context } from "telegraf"
import type { Update } from "telegraf/types"

export async function cmdStart(ctx: Context<Update>): Promise<void> {
  await ctx.reply(
    [
      "👋 Welcome!",
      "",
      "Use /premium to unlock access.",
      "Use /status to see your access status.",
    ].join("\n"),
  )
}
