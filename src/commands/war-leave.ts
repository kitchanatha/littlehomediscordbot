import { ChatInputCommandInteraction } from "discord.js";
import type { AttendanceService } from "../services/attendance-service.js";
import { env } from "../config/env.js";

export async function handleWarLeave(interaction: ChatInputCommandInteraction, service: AttendanceService) {
  if (env.WAR_LEAVE_CHANNEL_ID && interaction.channelId !== env.WAR_LEAVE_CHANNEL_ID) {
    await interaction.editReply(
      `❌ Please use this command in <#${env.WAR_LEAVE_CHANNEL_ID}>.\n❌ กรุณาใช้คำสั่งนี้ในช่อง <#${env.WAR_LEAVE_CHANNEL_ID}>`
    );
    return;
  }

  const result = await service.requestLeave(interaction.user.id);
  await interaction.editReply(
    `✅ Leave recorded for **${result.characterName}** (${result.dateLabel}).\n✅ บันทึกการลาสำหรับ **${result.characterName}** แล้ว (${result.dateLabel})`
  );
  console.log(`INFO Leave requested: ${interaction.user.id}`);
}
