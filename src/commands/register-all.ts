import { ChatInputCommandInteraction, GuildMember, Role } from "discord.js";
import { MemberService } from "../services/member-service.js";
import { env } from "../config/env.js";

export async function handleRegisterAll(interaction: ChatInputCommandInteraction, service: MemberService) {
  const member = interaction.member as GuildMember;
  const hasPermission = env.ASSIGN_ROLE_IDS.some((roleId) => member.roles.cache.has(roleId));

  if (!hasPermission) {
    await interaction.editReply({
      content: "❌ You don't have permission to use this command.\n❌ คุณไม่มีสิทธิ์ใช้คำสั่งนี้",
    });
    return;
  }

  const role = interaction.options.getRole("role") as Role | null;
  
  if (!env.ENABLE_MEMBERS_INTENT) {
    await interaction.editReply({
      content: "❌ The [Guild Members] intent is not enabled in the bot configuration.\n❌ ยังไม่ได้เปิดใช้งาน [Guild Members] intent ในการตั้งค่าของ Bot\n\nTo use this command, please:\n1. Enable **Server Members Intent** in the Discord Developer Portal.\n2. Set `ENABLE_MEMBERS_INTENT=true` in your `.env` file.\n3. Restart the bot.",
    });
    return;
  }

  await interaction.editReply("⏳ Registering members, please wait...");

  try {
    const guild = interaction.guild;
    if (!guild) throw new Error("Guild not found");

    let members = await guild.members.fetch();
    
    if (role) {
      members = members.filter(m => m.roles.cache.has(role.id));
    }

    // Filter out bots
    members = members.filter(m => !m.user.bot);

    const usersToRegister = members.map(m => ({
      discordId: m.id,
      discordUsername: m.user.username,
    }));

    const result = await service.bulkRegister(usersToRegister);

    const lines = [
      `✅ Bulk registration complete!`,
      `Registered: **${result.registeredCount}**`,
      `Skipped (already registered): **${result.skippedCount}**`,
    ];

    await interaction.editReply(lines.join("\n"));
    console.log(`INFO Bulk registration by ${interaction.user.id}: ${result.registeredCount} registered, ${result.skippedCount} skipped`);
  } catch (error) {
    console.error("ERROR in register_all:", error);
    await interaction.editReply("❌ An error occurred during bulk registration. Please ensure the bot has the [Guild Members] intent enabled in the Developer Portal.");
  }
}
