import { ChatInputCommandInteraction, GuildMemberRoleManager } from "discord.js";
import { MemberService, UserError } from "../services/member-service.js";
import { env } from "../config/env.js";

function isAdminInteraction(interaction: ChatInputCommandInteraction): boolean {
  const roles = interaction.member?.roles;
  return roles instanceof GuildMemberRoleManager
    ? env.ASSIGN_ROLE_IDS.some((roleId) => roles.cache.has(roleId))
    : Array.isArray(roles) && env.ASSIGN_ROLE_IDS.some((roleId) => roles.includes(roleId));
}

export async function handleSetClassColor(interaction: ChatInputCommandInteraction, service: MemberService): Promise<void> {
  if (!isAdminInteraction(interaction)) {
    await interaction.editReply("❌ You don't have permission to use this.\n❌ คุณไม่มีสิทธิ์ใช้คำสั่งนี้");
    return;
  }

  const className = interaction.options.getString("class", true);
  const hexInput = interaction.options.getString("hex", true).trim();
  const hex = hexInput.startsWith("#") ? hexInput : `#${hexInput}`;

  try {
    const result = await service.setClassColor(className, hex);
    await interaction.editReply(
      `✅ **${result.className}** color set to \`${result.colorHex}\`.\n` +
        `Repainted ${result.membersRecolored} member row(s) and ${result.jadtiRulesUpdated} จัดตี้ rule(s).`
    );
    console.log(`INFO Class color changed: ${result.className} -> ${result.colorHex} by ${interaction.user.id}`);
  } catch (error) {
    if (error instanceof UserError) {
      await interaction.editReply(error.message);
    } else {
      console.error("ERROR set_class_color failed", error);
      await interaction.editReply("❌ Something went wrong. Please try again later.\n❌ เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง");
    }
  }
}
