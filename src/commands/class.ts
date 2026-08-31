import { ChatInputCommandInteraction } from "discord.js";
import { MemberService } from "../services/member-service.js";
import type { ClassService } from "../services/class-service.js";

export async function handleClass(
  interaction: ChatInputCommandInteraction,
  service: MemberService,
  classService: ClassService
) {
  const discordId = interaction.user.id;
  const next = interaction.options.getString("new_class", true);
  const updated = await service.changeClass(discordId, next);
  const display = await classService.formatPlayerDisplay(updated);
  await interaction.editReply(`✅ Class updated to **${display.text}** (Class: ${updated.className}). The previous class was saved in history.`);
  console.log(`INFO Class changed: ${updated.memberId}`);
}
