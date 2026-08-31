import { ChatInputCommandInteraction } from "discord.js";
import { MemberService } from "../services/member-service.js";

export async function handleRegister(interaction: ChatInputCommandInteraction, service: MemberService) {
  const discordId = interaction.user.id;
  const username = interaction.user.username;
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
}
