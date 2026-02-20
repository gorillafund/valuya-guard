import { Telegraf, type Context } from "telegraf"
import type { Update } from "telegraf/types"
import type { BotConfig } from "./config.js"
import { cmdStart } from "./commands/start.js"
import { cmdPremium } from "./commands/premium.js"
import { cmdStatus } from "./commands/status.js"

export function buildBot(cfg: BotConfig): Telegraf<Context<Update>> {
  const bot = new Telegraf<Context<Update>>(cfg.telegramToken)

  bot.start((ctx) => cmdStart(ctx))
  bot.command("premium", (ctx) => cmdPremium(ctx, cfg))
  bot.command("status", (ctx) => cmdStatus(ctx, cfg))

  bot.on("text", async (ctx) => {
    const t = (ctx.message?.text || "").trim()
    if (t === "/help") return cmdStart(ctx)
    return ctx.reply("Try /premium or /status")
  })

  return bot
}
