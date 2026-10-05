import { ChatInputCommandInteraction } from "discord.js";
import type { AttendanceService } from "../services/attendance-service.js";
import { isWarCheckInOpen, WAR_CHECKIN_CLOSED_MESSAGE } from "../utils/war-window.js";

// Manual fallback for members who join the War voice channel and aren't picked up
// automatically (e.g. they were already in the channel before the bot restarted).
export async function handleWarCheckin(interaction: ChatInputCommandInteraction, service: AttendanceService) {
  if (!isWarCheckInOpen()) {
    await interaction.editReply(WAR_CHECKIN_CLOSED_MESSAGE);
    return;
  }
  const result = await service.checkIn(interaction.user.id);
  await interaction.editReply(
    `✅ Checked in as **${result.characterName}** for ${result.dateLabel}.\n✅ เช็คชื่อเข้าร่วมในนาม **${result.characterName}** สำหรับ ${result.dateLabel} แล้ว`
  );
  console.log(`INFO Manual check-in: ${interaction.user.id}`);
}
