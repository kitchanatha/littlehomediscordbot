import { ChatInputCommandInteraction } from "discord.js";
import { MemberService } from "../services/member-service.js";
import type { ClassService } from "../services/class-service.js";

export async function handleHistory(
  interaction: ChatInputCommandInteraction,
  service: MemberService,
  classService: ClassService
) {
  const discordId = interaction.user.id;
  const m = await service.profile(discordId);
  const history = await service.history(discordId);

  const display = await classService.formatPlayerDisplay(m);

  if (!history.length) {
    await interaction.editReply(`No changes recorded yet for ${display.text}.`);
    return;
  }
  const lines = history.slice(0, 15).map((h) => {
    const labels: Record<string, string> = {
      name: "Name",
      class: "Class",
      team: "Team",
      party: "Party",
    };
    const label = labels[h.type] || h.type;
    return `• **${label}**: ${h.oldValue} → ${h.newValue} (${new Date(h.changedAt).toLocaleString("en-GB", { timeZone: "Asia/Bangkok" })})`;
  });
  await interaction.editReply(lines.join("\n"));
}
