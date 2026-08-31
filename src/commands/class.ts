import { ChatInputCommandInteraction } from "discord.js";
import { MemberService } from "../services/member-service.js";

export async function handleClass(interaction: ChatInputCommandInteraction, service: MemberService) {
  const discordId = interaction.user.id;
  const next = interaction.options.getString("new_class", true);
  const updated = await service.changeClass(discordId, next);
  await interaction.editReply(`✅ Class updated to **${updated.className}**. The previous class was saved in history.`);
  console.log(`INFO Class changed: ${updated.memberId}`);
}
