import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  Client,
  GatewayIntentBits,
  Interaction,
} from "discord.js"
import { createDiscordGuard } from "@valuya/discord-bot"

const client = new Client({ intents: [GatewayIntentBits.Guilds] })

const guard = createDiscordGuard({
  base: process.env.VALUYA_BASE!,
  tenantToken: process.env.VALUYA_TENANT_TOKEN!,
  defaultResource: process.env.VALUYA_RESOURCE || "discord:bot:assistant:premium",
  defaultPlan: process.env.VALUYA_PLAN || "standard",
})

client.on("interactionCreate", async (interaction: Interaction) => {
  if (!interaction.isChatInputCommand()) return

  if (interaction.commandName === "premium") {
    try {
      const decision = await guard.gate({ user: { id: interaction.user.id, username: interaction.user.username } })
      if (decision.active) {
        await interaction.reply({ content: "Access granted. Running premium action now.", ephemeral: true })
        return
      }

      const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setLabel(decision.prompt.button.label)
          .setStyle(ButtonStyle.Link)
          .setURL(decision.prompt.button.url),
      )

      await interaction.reply({
        content: `${decision.prompt.message}\n${decision.prompt.followupHint}`,
        components: [row],
        ephemeral: true,
      })
    } catch (err) {
      console.error("premium_error", err)
      await interaction.reply({ content: "Temporary error while checking access. Please retry.", ephemeral: true })
    }
    return
  }

  if (interaction.commandName === "status") {
    try {
      const status = await guard.status({ user: { id: interaction.user.id, username: interaction.user.username } })
      await interaction.reply({
        content: status.active
          ? "Payment confirmed. Premium access is active."
          : "No active premium access yet. Complete payment and retry /premium.",
        ephemeral: true,
      })
    } catch (err) {
      console.error("status_error", err)
      await interaction.reply({ content: "Could not verify status right now. Please retry.", ephemeral: true })
    }
  }
})

client.login(process.env.DISCORD_BOT_TOKEN)
