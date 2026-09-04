import { ChatInputCommandInteraction, GuildMemberRoleManager } from "discord.js";
import type { AttendanceService } from "../services/attendance-service.js";
import { UserError } from "../services/member-service.js";
import { env } from "../config/env.js";

export async function handleCheckin(interaction: ChatInputCommandInteraction, attendanceService: AttendanceService) {
  const roles = interaction.member?.roles;
  const isAdmin = roles instanceof GuildMemberRoleManager
    ? env.ASSIGN_ROLE_IDS.some((roleId) => roles.cache.has(roleId))
    : Array.isArray(roles) && env.ASSIGN_ROLE_IDS.some((roleId) => roles.includes(roleId));

  if (!isAdmin) {
    await interaction.editReply("❌ You don't have permission to use this.\n❌ คุณไม่มีสิทธิ์ใช้คำสั่งนี้");
    return;
  }

  const memberId = interaction.options.getString("member", true);
  try {
    const result = await attendanceService.checkInMember(memberId);
    await interaction.editReply(`✅ Checked in **${result.characterName}** for ${result.dateLabel}.`);
  } catch (error) {
    if (error instanceof UserError) {
      await interaction.editReply(error.message);
    } else {
      console.error("ERROR /checkin failed", error);
      await interaction.editReply("❌ Something went wrong. Please try again later.\n❌ เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง");
    }
  }
}
