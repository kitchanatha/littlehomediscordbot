import { Client, EmbedBuilder, Events, GatewayIntentBits } from "discord.js";
import { env } from "./config/env.js";
import { GoogleSheetsMemberRepository } from "./repositories/google-sheets-member-repository.js";
import { MemberService, UserError } from "./services/member-service.js";

const repository = new GoogleSheetsMemberRepository();
const service = new MemberService(repository);
const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once(Events.ClientReady, (readyClient) => {
  console.log(`INFO Bot ready as ${readyClient.user.tag}`);
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  await interaction.deferReply({ ephemeral: true });

  try {
    const discordId = interaction.user.id;
    const username = interaction.user.username;

    switch (interaction.commandName) {
      case "register": {
        const characterName = interaction.options.getString("character_name", true);
        const className = interaction.options.getString("class") ?? undefined;
        const result = await service.register({ discordId, discordUsername: username, characterName, className });
        const m = result.member;
        const lines = [
          "✅ Registration complete!",
          `Character: **${m.characterName}**`,
          `Class: **${m.className}**`,
          `Team: **${m.team || "Not assigned"}**`,
          `Party: **${m.party || "Not assigned"}**`,
        ];

        if (result.legacyLinked) {
          lines.push("ℹ️ Old guild data was linked automatically.");
          if (result.classOverridden) {
            lines.push(`⚠️ Note: Your legacy class **${m.className}** was used instead of the one you provided.`);
          }
        } else {
          lines.push("ℹ️ No legacy record was found.");
        }

        await interaction.editReply(lines.join("\n"));
        console.log(`INFO Member registered: ${discordId}`);
        break;
      }
      case "profile": {
        const m = await service.profile(discordId);
        const embed = new EmbedBuilder()
          .setTitle(`${m.characterName}`)
          .addFields(
            { name: "Class", value: m.className || "-", inline: true },
            { name: "Team", value: m.team || "-", inline: true },
            { name: "Party", value: m.party || "-", inline: true },
            { name: "Status", value: m.status || "-", inline: true },
          )
          .setFooter({ text: `Member ID: ${m.memberId}` });
        await interaction.editReply({ embeds: [embed] });
        break;
      }
      case "name": {
        const next = interaction.options.getString("new_name", true);
        const updated = await service.changeName(discordId, next);
        await interaction.editReply(`✅ Character name updated to **${updated.characterName}**. The previous name was saved in history.`);
        console.log(`INFO Name changed: ${updated.memberId}`);
        break;
      }
      case "class": {
        const next = interaction.options.getString("new_class", true);
        const updated = await service.changeClass(discordId, next);
        await interaction.editReply(`✅ Class updated to **${updated.className}**. The previous class was saved in history.`);
        console.log(`INFO Class changed: ${updated.memberId}`);
        break;
      }
      case "history": {
        const history = await service.history(discordId);
        if (!history.length) {
          await interaction.editReply("No name or class changes yet.");
          break;
        }
        const lines = history.slice(0, 15).map((h) => {
          const label = h.type === "name" ? "Name" : "Class";
          return `• **${label}**: ${h.oldValue} → ${h.newValue} (${new Date(h.changedAt).toLocaleString("en-GB", { timeZone: "Asia/Bangkok" })})`;
        });
        await interaction.editReply(lines.join("\n"));
        break;
      }
    }
  } catch (error) {
    if (error instanceof UserError) {
      await interaction.editReply(error.message);
      return;
    }
    console.error("ERROR Command failed", error instanceof Error ? error.message : error);
    await interaction.editReply("❌ Something went wrong while accessing the guild database. Please try again later.");
  }
});

await client.login(env.DISCORD_TOKEN);
