import { Telegraf } from "telegraf"
import { createTelegramGuard } from "@valuya/telegram-bot"

const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN!)

const guard = createTelegramGuard({
  base: process.env.VALUYA_BASE!,
  tenantToken: process.env.VALUYA_TENANT_TOKEN!,
  defaultResource: process.env.VALUYA_RESOURCE || "telegram:bot:assistant:premium",
  defaultPlan: process.env.VALUYA_PLAN || "standard",
})

bot.command("premium", async (ctx) => {
  const user = ctx.from
  if (!user) return

  try {
    const decision = await guard.gate({ user: { id: user.id, username: user.username } })
    if (decision.active) {
      await ctx.reply("Access granted. Running premium action now.")
      return
    }

    await ctx.reply(decision.prompt.text, {
      reply_markup: {
        inline_keyboard: [[{ text: decision.prompt.keyboard[0].text, url: decision.prompt.keyboard[0].url }]],
      },
    })
  } catch (err) {
    console.error("premium_error", err)
    await ctx.reply("Temporary error while checking access. Please retry in a moment.")
  }
})

bot.command("status", async (ctx) => {
  const user = ctx.from
  if (!user) return

  try {
    const status = await guard.status({ user: { id: user.id, username: user.username } })
    await ctx.reply(
      status.active
        ? "Payment confirmed. Premium access is active."
        : "No active premium access yet. Complete payment and retry /premium.",
    )
  } catch (err) {
    console.error("status_error", err)
    await ctx.reply("Could not verify status right now. Please retry.")
  }
})

bot.launch().then(() => console.log("Telegram template bot started"))
