import { loadConfig } from "./config.js"
import { buildBot } from "./bot.js"

async function main() {
  const cfg = loadConfig()
  const bot = buildBot(cfg)

  // Start long-polling (fastest / simplest)
  await bot.launch()
  console.log("[telegram-bot] started (long polling)")
  console.log(`[telegram-bot] resource=${cfg.resource} plan=${cfg.plan}`)

  process.once("SIGINT", () => bot.stop("SIGINT"))
  process.once("SIGTERM", () => bot.stop("SIGTERM"))
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
