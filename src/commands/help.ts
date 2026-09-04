import { ChatInputCommandInteraction, EmbedBuilder, GuildMemberRoleManager } from "discord.js";
import { env } from "../config/env.js";

// Bilingual (English / Thai) so it's useful to the whole guild regardless of which language a
// member is more comfortable reading — matches the bot's existing convention of pairing every
// user-facing message with a Thai translation (see UserError messages throughout).
export async function handleHelp(interaction: ChatInputCommandInteraction) {
  const roles = interaction.member?.roles;
  const isAdmin = roles instanceof GuildMemberRoleManager
    ? env.ASSIGN_ROLE_IDS.some((roleId) => roles.cache.has(roleId))
    : Array.isArray(roles) && env.ASSIGN_ROLE_IDS.some((roleId) => roles.includes(roleId));

  const embed = new EmbedBuilder()
    .setTitle("📖 Commands / คำสั่งทั้งหมด")
    .setColor(0x5865f2)
    .addFields(
      {
        name: "👤 Profile / โปรไฟล์",
        value: [
          "`/register` — Register your character / ลงทะเบียนตัวละครของคุณ",
          "`/profile` — View your profile / ดูโปรไฟล์ของคุณ",
          "`/name` — Change your character name / เปลี่ยนชื่อตัวละคร",
          "`/class` — Change your class / เปลี่ยนอาชีพ",
          "`/name_class` — Update name and/or class in one step / อัปเดตชื่อและ/หรืออาชีพในคำสั่งเดียว",
          "`/history` — View your name/class change history / ดูประวัติการเปลี่ยนชื่อและอาชีพ",
        ].join("\n"),
      },
      {
        name: "⚔️ War / วอร์",
        value: [
          "`/war_roster` — View the War team/party roster / ดูรายชื่อทีมและปาร์ตี้วอร์",
          "`/war_checkin` — Manually check in for today's War (usually automatic via voice) / เช็คอินวอร์ด้วยตนเอง (ปกติเช็คอินอัตโนมัติเมื่อเข้าห้องวอยซ์)",
          "`/war_leave` — Let the guild know you can't make today's War / แจ้งลาวอร์วันนี้",
        ].join("\n"),
      },
      {
        name: "🎫 Queue / คิว",
        value: [
          "`/queue_join` — Join the Card or Accessory queue / เข้าคิวการ์ดหรือคิวประดับ",
          "`/queue_leave` — Leave a queue / ออกจากคิว",
          "`/queue_status` — View your position in each queue / ดูลำดับคิวของคุณ",
          "`/queue_list` — View the current queue order / ดูรายชื่อคิวปัจจุบัน",
        ].join("\n"),
      },
      {
        name: "🛡️ Admin only / สำหรับแอดมินเท่านั้น",
        value: [
          "`/register_all` — Bulk-register server members as Pending / ลงทะเบียนสมาชิกในเซิร์ฟเวอร์ทั้งหมดแบบรอดำเนินการ",
          "`/assign` — Assign a member's Team and Party / กำหนดทีมและปาร์ตี้ให้สมาชิก",
          "`/queue_add` — Add a member to a queue / เพิ่มสมาชิกเข้าคิว",
          "`/queue_remove` — Remove a member from a queue / เอาสมาชิกออกจากคิว",
        ].join("\n"),
      }
    )
    .setFooter({
      text: isAdmin
        ? "You have admin access to the commands above. / คุณมีสิทธิ์แอดมินสำหรับคำสั่งด้านบน"
        : "Admin-only commands require a guild officer role. / คำสั่งสำหรับแอดมินต้องมีตำแหน่งเจ้าหน้าที่กิลด์",
    });

  await interaction.editReply({ embeds: [embed] });
}
