import { ChatInputCommandInteraction, GuildMemberRoleManager } from "discord.js";
import { MemberService } from "../services/member-service.js";
import { env } from "../config/env.js";

export async function handleAssign(interaction: ChatInputCommandInteraction, service: MemberService) {
  const roles = interaction.member?.roles;
  const hasAdmin = roles instanceof GuildMemberRoleManager 
    ? env.ASSIGN_ROLE_IDS.some(roleId => roles.cache.has(roleId)) 
    : Array.isArray(roles) && env.ASSIGN_ROLE_IDS.some(roleId => roles.includes(roleId));

  if (!hasAdmin) {
    await interaction.editReply("❌ คุณไม่มีสิทธิ์ใช้คำสั่งนี้");
    return;
  }

  const targetUser = interaction.options.getUser("member", true);
  const team = interaction.options.getString("team", true);
  const party = interaction.options.getInteger("party", true);

  const updated = await service.assignMember({
    targetDiscordId: targetUser.id,
    team,
    party,
    adminDiscordId: interaction.user.id,
  });

  await interaction.editReply(`✅ **${updated.characterName}** assigned to Team **${updated.team}** / Party **${updated.party}**`);
  console.log(`INFO Member assigned: ${targetUser.id} by ${interaction.user.id}`);
}
