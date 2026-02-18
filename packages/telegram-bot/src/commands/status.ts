import type { Context } from "telegraf"
import type { Update } from "telegraf/types"
import type { BotConfig } from "../config.js"
import { telegramSubject } from "../subject.js"
import { fetchEntitlements } from "@valuya/agent"

export async function cmdStatus(
  ctx: Context<Update>,
  cfg: BotConfig,
): Promise<void> {
  const userId = ctx.from?.id
  if (!userId) {
    await ctx.reply("Missing Telegram user id.")
    return
  }

  const subject = telegramSubject(userId)

  const ent = await fetchEntitlements({
    cfg: { base: cfg.valuyaBase, tenant_token: cfg.valuyatenant_token },
    plan: cfg.plan,
    resource: cfg.resource,
    subject,
  })

  if (ent?.active) {
    await ctx.reply("✅ Access is active.")
    return
  }

  await ctx.reply("🔒 Access not active yet. Use /premium to unlock.")
}
