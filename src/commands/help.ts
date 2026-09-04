import { ChatInputCommandInteraction, EmbedBuilder, GuildMemberRoleManager } from "discord.js";
import { env } from "../config/env.js";

// Bilingual (English / Thai) so it's useful to the whole guild regardless of which language a
// member is more comfortable reading — matches the bot's existing convention of pairing every
// user-facing message with a Thai translation (see UserError messages throughout).

type Entry = { name: string; description: string };

const SECTIONS: { title: string; commands: Entry[] }[] = [
  {
    title: "👤 Profile / โปรไฟล์",
    commands: [
      { name: "register", description: "Register your character / ลงทะเบียนตัวละครของคุณ" },
      { name: "profile", description: "View your profile / ดูโปรไฟล์ของคุณ" },
      { name: "name", description: "Change your character name / เปลี่ยนชื่อตัวละคร" },
      { name: "class", description: "Change your class / เปลี่ยนอาชีพ" },
      { name: "name_class", description: "Update name and/or class in one step / อัปเดตชื่อและ/หรืออาชีพในคำสั่งเดียว" },
      { name: "history", description: "View your name/class change history / ดูประวัติการเปลี่ยนชื่อและอาชีพ" },
    ],
  },
  {
    title: "⚔️ War / วอร์",
    commands: [
      { name: "war_roster", description: "View the War team/party roster / ดูรายชื่อทีมและปาร์ตี้วอร์" },
      { name: "war_checkin", description: "Manually check in for today's War (usually automatic via voice) / เช็คอินวอร์ด้วยตนเอง (ปกติเช็คอินอัตโนมัติเมื่อเข้าห้องวอยซ์)" },
      { name: "war_leave", description: "Let the guild know you can't make today's War / แจ้งลาวอร์วันนี้" },
    ],
  },
  {
    title: "🎫 Queue / คิว",
    commands: [
      { name: "queue_join", description: "Join the Card or Accessory queue / เข้าคิวการ์ดหรือคิวประดับ" },
      { name: "queue_leave", description: "Leave a queue / ออกจากคิว" },
      { name: "queue_status", description: "View your position in each queue / ดูลำดับคิวของคุณ" },
      { name: "queue_list", description: "View the current queue order / ดูรายชื่อคิวปัจจุบัน" },
    ],
  },
  {
    title: "🛡️ Admin only / สำหรับแอดมินเท่านั้น",
    commands: [
      { name: "register_all", description: "Bulk-register server members as Pending / ลงทะเบียนสมาชิกในเซิร์ฟเวอร์ทั้งหมดแบบรอดำเนินการ" },
      { name: "assign", description: "Assign a member's Team and Party / กำหนดทีมและปาร์ตี้ให้สมาชิก" },
      { name: "queue_add", description: "Add a member to a queue / เพิ่มสมาชิกเข้าคิว" },
      { name: "queue_remove", description: "Remove a member from a queue / เอาสมาชิกออกจากคิว" },
    ],
  },
];

export async function handleHelp(interaction: ChatInputCommandInteraction) {
  const roles = interaction.member?.roles;
  const isAdmin = roles instanceof GuildMemberRoleManager
    ? env.ASSIGN_ROLE_IDS.some((roleId) => roles.cache.has(roleId))
    : Array.isArray(roles) && env.ASSIGN_ROLE_IDS.some((roleId) => roles.includes(roleId));

  // </name:id> is Discord's real clickable-command-mention syntax — clicking it drops the
  // command straight into the user's message box. Falls back to plain `/name` text if the
  // guild's registered commands can't be fetched for any reason.
  let idByName = new Map<string, string>();
  try {
    const commands = await interaction.guild?.commands.fetch();
    if (commands) idByName = new Map(commands.map((c) => [c.name, c.id]));
  } catch (err) {
    console.error("WARN /help failed to fetch command IDs for clickable mentions", err);
  }

  function mention(name: string): string {
    const id = idByName.get(name);
    return id ? `</${name}:${id}>` : `\`/${name}\``;
  }

  const embed = new EmbedBuilder()
    .setTitle("📖 Commands / คำสั่งทั้งหมด")
    .setColor(0x5865f2)
    .addFields(
      SECTIONS.map((section) => ({
        name: section.title,
        value: section.commands.map((c) => `${mention(c.name)} — ${c.description}`).join("\n"),
      }))
    )
    .setFooter({
      text: isAdmin
        ? "You have admin access to the commands above. / คุณมีสิทธิ์แอดมินสำหรับคำสั่งด้านบน"
        : "Admin-only commands require a guild officer role. / คำสั่งสำหรับแอดมินต้องมีตำแหน่งเจ้าหน้าที่กิลด์",
    });

  await interaction.editReply({ embeds: [embed] });
}
