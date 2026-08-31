import { ChatInputCommandInteraction } from "discord.js";
import { MemberService } from "../services/member-service.js";

export async function handleName(interaction: ChatInputCommandInteraction, service: MemberService) {
  const discordId = interaction.user.id;
  const next = interaction.options.getString("new_name", true);
  const updated = await service.changeName(discordId, next);
  await interaction.editReply(`✅ Character name updated to **${updated.characterName}**. The previous name was saved in history.`);
  console.log(`INFO Name changed: ${updated.memberId}`);
}
