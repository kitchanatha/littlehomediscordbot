import { ChatInputCommandInteraction } from "discord.js";
import { MemberService } from "../services/member-service.js";

export async function handleHistory(interaction: ChatInputCommandInteraction, service: MemberService) {
  const discordId = interaction.user.id;
  const history = await service.history(discordId);
  if (!history.length) {
    await interaction.editReply("No name or class changes yet.");
    return;
  }
  const lines = history.slice(0, 15).map((h) => {
    const label = h.type === "name" ? "Name" : "Class";
    return `• **${label}**: ${h.oldValue} → ${h.newValue} (${new Date(h.changedAt).toLocaleString("en-GB", { timeZone: "Asia/Bangkok" })})`;
  });
  await interaction.editReply(lines.join("\n"));
}
