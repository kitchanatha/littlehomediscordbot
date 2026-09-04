import { ChatInputCommandInteraction, GuildMemberRoleManager } from "discord.js";
import type { AttendanceService } from "../services/attendance-service.js";
import { env } from "../config/env.js";
import { buildCheckinPanelPage } from "../discord/checkin-panel.js";

export async function handleWarCheckinPanel(interaction: ChatInputCommandInteraction, attendanceService: AttendanceService) {
  const roles = interaction.member?.roles;
  const isAdmin = roles instanceof GuildMemberRoleManager
    ? env.ASSIGN_ROLE_IDS.some((roleId) => roles.cache.has(roleId))
    : Array.isArray(roles) && env.ASSIGN_ROLE_IDS.some((roleId) => roles.includes(roleId));

  if (!isAdmin) {
    await interaction.editReply("❌ You don't have permission to use this.\n❌ คุณไม่มีสิทธิ์ใช้คำสั่งนี้");
    return;
  }

  const content = await buildCheckinPanelPage(attendanceService, 0);
  await interaction.editReply(content);
}
