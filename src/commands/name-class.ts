import { ChatInputCommandInteraction, GuildMember } from "discord.js";
import { MemberService } from "../services/member-service.js";
import { env } from "../config/env.js";
import type { ClassService } from "../services/class-service.js";

export async function handleNameClass(
  interaction: ChatInputCommandInteraction,
  service: MemberService,
  classService: ClassService
) {
  const targetUser = interaction.options.getUser("member");
  const newName = interaction.options.getString("name");
  const newClass = interaction.options.getString("class");

  const callerDiscordId = interaction.user.id;
  let targetDiscordId = callerDiscordId;

  if (targetUser && targetUser.id !== callerDiscordId) {
    const member = interaction.member as GuildMember;
    const hasPermission = env.ASSIGN_ROLE_IDS.some((roleId) => member.roles.cache.has(roleId));

    if (!hasPermission) {
      await interaction.editReply({
        content: "❌ You don't have permission to edit another member.\n❌ คุณไม่มีสิทธิ์แก้ไขข้อมูลของสมาชิกคนอื่น",
      });
      return;
    }
    targetDiscordId = targetUser.id;
  }

  const result = await service.updateNameAndClass({
    targetDiscordId,
    newName: newName || undefined,
    newClass: newClass || undefined,
    changedByDiscordId: callerDiscordId,
  });

  if (!result.nameChanged && !result.classChanged) {
    await interaction.editReply({
      content: "ℹ️ No changes were needed.\nℹ️ ไม่มีข้อมูลที่ต้องเปลี่ยน",
    });
    return;
  }

  const display = await classService.formatPlayerDisplay(result.member);

  const messages: string[] = [];
  if (result.nameChanged && result.classChanged) {
    messages.push(`✅ Profile updated.\nName: **${display.text}**\nClass: **${result.member.className}**`);
    messages.push(`✅ อัปเดตข้อมูลแล้ว\nชื่อ: **${display.text}**\nอาชีพ: **${result.member.className}**`);
  } else if (result.nameChanged) {
    messages.push(`✅ Character name updated to **${display.text}**.`);
    messages.push(`✅ เปลี่ยนชื่อตัวละครเป็น **${display.text}** แล้ว`);
  } else if (result.classChanged) {
    messages.push(`✅ Class updated to **${display.text}** (Class: ${result.member.className}).`);
    messages.push(`✅ เปลี่ยนอาชีพเป็น **${display.text}** (อาชีพ: ${result.member.className}) แล้ว`);
  }

  await interaction.editReply({ content: messages.join("\n\n") });
  console.log(`INFO Profile updated for ${targetDiscordId} by ${callerDiscordId}`);
}
