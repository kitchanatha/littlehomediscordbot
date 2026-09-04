import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonInteraction,
  ButtonStyle,
  EmbedBuilder,
  GuildMemberRoleManager,
} from "discord.js";
import { env } from "../config/env.js";
import type { AttendanceService } from "../services/attendance-service.js";
import type { Member } from "../types/member.js";

// Admin check-in checklist: /war_checkin_panel posts a list of everyone not yet marked present
// today, one button per member — click to check them in. Discord caps a message at 25
// components (5 rows x 5), so the list is paginated: 20 member buttons + one nav row
// (Prev/Refresh/Next). The whole thing is one shared, non-ephemeral message so every admin
// watching the channel sees checks land in real time.
const MEMBERS_PER_PAGE = 20;

const BUTTON_PREFIX = {
  check: "checkin_member",
  page: "checkin_page",
  refresh: "checkin_refresh",
} as const;

function isAdminInteraction(interaction: ButtonInteraction): boolean {
  const roles = interaction.member?.roles;
  return roles instanceof GuildMemberRoleManager
    ? env.ASSIGN_ROLE_IDS.some((roleId) => roles.cache.has(roleId))
    : Array.isArray(roles) && env.ASSIGN_ROLE_IDS.some((roleId) => roles.includes(roleId));
}

function buildContent(members: Member[], page: number, totalPages: number, justChecked?: string) {
  const embed = new EmbedBuilder()
    .setTitle("✅ War Check-in Panel / เช็คอินวอร์")
    .setColor(0x57f287)
    .setDescription(
      members.length === 0
        ? "Everyone is checked in! / เช็คอินครบทุกคนแล้ว!"
        : `Click a name to mark them present. ${members.length} still need checking in.\nคลิกชื่อเพื่อเช็คอิน — เหลืออีก ${members.length} คน`
    )
    .setFooter({ text: `Page ${page + 1}/${Math.max(totalPages, 1)}${justChecked ? ` — just checked in: ${justChecked}` : ""}` });

  const pageMembers = members.slice(page * MEMBERS_PER_PAGE, (page + 1) * MEMBERS_PER_PAGE);
  const rows: ActionRowBuilder<ButtonBuilder>[] = [];
  for (let i = 0; i < pageMembers.length; i += 5) {
    const row = new ActionRowBuilder<ButtonBuilder>();
    for (const member of pageMembers.slice(i, i + 5)) {
      row.addComponents(
        new ButtonBuilder()
          .setCustomId(`${BUTTON_PREFIX.check}|${member.memberId}`)
          .setLabel(member.characterName.slice(0, 80))
          .setStyle(ButtonStyle.Secondary)
      );
    }
    rows.push(row);
  }

  const navRow = new ActionRowBuilder<ButtonBuilder>();
  navRow.addComponents(
    new ButtonBuilder().setCustomId(`${BUTTON_PREFIX.page}|${page - 1}`).setLabel("◀ Prev").setStyle(ButtonStyle.Primary).setDisabled(page <= 0),
    new ButtonBuilder().setCustomId(BUTTON_PREFIX.refresh).setLabel("🔄 Refresh").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`${BUTTON_PREFIX.page}|${page + 1}`).setLabel("Next ▶").setStyle(ButtonStyle.Primary).setDisabled(page >= totalPages - 1)
  );
  if (members.length > 0) rows.push(navRow);

  return { embeds: [embed], components: rows };
}

export async function buildCheckinPanelPage(attendanceService: AttendanceService, page: number, justChecked?: string) {
  const members = await attendanceService.getMembersNeedingCheckIn();
  const totalPages = Math.max(1, Math.ceil(members.length / MEMBERS_PER_PAGE));
  const clampedPage = Math.min(Math.max(page, 0), totalPages - 1);
  return buildContent(members, clampedPage, totalPages, justChecked);
}

export function isCheckinPanelButton(customId: string): boolean {
  return (
    customId.startsWith(`${BUTTON_PREFIX.check}|`) ||
    customId.startsWith(`${BUTTON_PREFIX.page}|`) ||
    customId === BUTTON_PREFIX.refresh
  );
}

export async function handleCheckinPanelButton(interaction: ButtonInteraction, attendanceService: AttendanceService): Promise<void> {
  if (!isAdminInteraction(interaction)) {
    await interaction.reply({ content: "❌ You don't have permission to use this.\n❌ คุณไม่มีสิทธิ์ใช้ปุ่มนี้", ephemeral: true });
    return;
  }

  // Ack within Discord's 3s window immediately — rebuilding the page does several sequential
  // Sheets reads and can be slow, which previously caused "app didn't respond in time".
  await interaction.deferUpdate();

  const [prefix, arg] = interaction.customId.split("|");

  if (prefix === BUTTON_PREFIX.check) {
    let justChecked: string | undefined;
    try {
      const result = await attendanceService.checkInMember(arg);
      justChecked = result.characterName;
    } catch (error) {
      console.error("ERROR Checkin panel button failed", error);
    }
    const content = await buildCheckinPanelPage(attendanceService, 0, justChecked);
    await interaction.editReply(content);
    return;
  }

  const targetPage = prefix === BUTTON_PREFIX.page ? parseInt(arg, 10) || 0 : 0;
  const content = await buildCheckinPanelPage(attendanceService, targetPage);
  await interaction.editReply(content);
}
