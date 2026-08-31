import { ChatInputCommandInteraction, EmbedBuilder } from "discord.js";
import { MemberService } from "../services/member-service.js";

export async function handleProfile(interaction: ChatInputCommandInteraction, service: MemberService) {
  const discordId = interaction.user.id;
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
}
