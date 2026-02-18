import type { Context } from "telegraf"
import type { Update } from "telegraf/types"
import type { BotConfig } from "../config.js"
import { telegramSubject } from "../subject.js"
import { ensureAccess } from "../valuya.js"

// ✅ explicit annotation avoids non-portable inferred types
export async function cmdPremium(
  ctx: Context<Update>,
  cfg: BotConfig,
): Promise<void> {
  const userId = ctx.from?.id
  if (!userId) {
    await ctx.reply("Missing Telegram user id.")
    return
  }

  const subject = telegramSubject(userId)

  await ctx.reply("Checking access…")

  const res = await ensureAccess({
    valuyaBase: cfg.valuyaBase,
    valuyatenant_token: cfg.valuyatenant_token,
    subject,
    resource: cfg.resource,
    plan: cfg.plan,
    currency: cfg.currency,
    amountCents: cfg.amountCents,
    privateKey: cfg.privateKey,
    fromAddress: cfg.fromAddress,
    pollIntervalMs: cfg.pollIntervalMs,
    pollTimeoutMs: cfg.pollTimeoutMs,
  })

  if (res.ok && res.state === "already_active") {
    await ctx.reply("✅ You already have access.")
    return
  }

  if (res.ok) {
    const lines = [
      "✅ Payment confirmed & access unlocked!",
      res.sessionId ? `Session: ${res.sessionId}` : "",
      res.txHash ? `Tx: ${res.txHash}` : "",
      res.mandateId ? `Mandate: ${res.mandateId}` : "",
    ].filter(Boolean)

    await ctx.reply(lines.join("\n"))
    return
  }

  const failLines = [
    "❌ Could not unlock access.",
    `State: ${res.state}`,
    res.sessionId ? `Session: ${res.sessionId}` : "",
    res.txHash ? `Tx: ${res.txHash}` : "",
  ].filter(Boolean)

  await ctx.reply(failLines.join("\n"))
}
