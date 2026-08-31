import { ChatInputCommandInteraction } from "discord.js";
import { MemberService } from "../services/member-service.js";
import type { ClassService } from "../services/class-service.js";

export async function handleName(
  interaction: ChatInputCommandInteraction,
  service: MemberService,
  classService: ClassService
) {
  const discordId = interaction.user.id;
  const next = interaction.options.getString("new_name", true);
  const updated = await service.changeName(discordId, next);
  const display = await classService.formatPlayerDisplay(updated);
  await interaction.editReply(`✅ Character name updated to **${display.text}**. The previous name was saved in history.`);
  console.log(`INFO Name changed: ${updated.memberId}`);
}
