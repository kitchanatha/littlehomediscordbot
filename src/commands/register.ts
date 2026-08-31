import { ChatInputCommandInteraction } from "discord.js";
import { MemberService } from "../services/member-service.js";
import type { ClassService } from "../services/class-service.js";

export async function handleRegister(
  interaction: ChatInputCommandInteraction,
  service: MemberService,
  classService: ClassService
) {
  const discordId = interaction.user.id;
  const username = interaction.user.username;
  const characterName = interaction.options.getString("name", true);
  const className = interaction.options.getString("class", true);

  const result = await service.register({ discordId, discordUsername: username, characterName, className });
  const m = result.member;
  
  const display = await classService.formatPlayerDisplay(m);
  
  const lines = [
    "✅ Registration complete!",
    `Character: **${display.text}**`,
    `Class: **${m.className}**`,
    `Team: **${m.team || "Not assigned"}**`,
    `Party: **${m.party || "Not assigned"}**`,
  ];

  if (result.legacyLinked) {
    lines.push("ℹ️ Old guild data was linked automatically.");
  } else {
    lines.push("ℹ️ No legacy record was found.");
  }

  await interaction.editReply(lines.join("\n"));
  console.log(`INFO Member registered: ${discordId}`);
}
