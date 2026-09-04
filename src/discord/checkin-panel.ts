import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonInteraction,
  ButtonStyle,
  EmbedBuilder,
  GuildMemberRoleManager,
  StringSelectMenuBuilder,
  StringSelectMenuInteraction,
} from "discord.js";
import { env } from "../config/env.js";
import type { AttendanceService } from "../services/attendance-service.js";
import type { Member } from "../types/member.js";

// Admin check-in checklist: /war_checkin_panel posts a list of everyone not yet marked present
// today as one multi-select dropdown (Discord's closest thing to a checkbox list — pick several
// names, it checks them all in on close, no per-person click needed) plus Prev/Refresh/Next
// paging underneath. Capped at 25 per page (Discord's own select-menu option limit). The whole
// thing is one shared, non-ephemeral message so every admin watching the channel sees checks
// land in real time.
const MEMBERS_PER_PAGE = 25;

const IDS = {
  select: "checkin_select",
  page: "checkin_page",
  refresh: "checkin_refresh",
} as const;

function isAdminInteraction(interaction: ButtonInteraction | StringSelectMenuInteraction): boolean {
  const roles = interaction.member?.roles;
  return roles instanceof GuildMemberRoleManager
    ? env.ASSIGN_ROLE_IDS.some((roleId) => roles.cache.has(roleId))
    : Array.isArray(roles) && env.ASSIGN_ROLE_IDS.some((roleId) => roles.includes(roleId));
}

function buildContent(members: Member[], page: number, totalPages: number, justChecked?: string[]) {
  const embed = new EmbedBuilder()
    .setTitle("✅ War Check-in Panel / เช็คอินวอร์")
    .setColor(0x57f287)
    .setDescription(
      members.length === 0
        ? "Everyone is checked in! / เช็คอินครบทุกคนแล้ว!"
        : `Select one or more names below to check them in.\n${members.length} still need checking in.\nเลือกชื่อเพื่อเช็คอิน — เหลืออีก ${members.length} คน`
    )
    .setFooter({
      text: `Page ${page + 1}/${Math.max(totalPages, 1)}${justChecked?.length ? ` — just checked in: ${justChecked.join(", ")}` : ""}`,
    });

  const rows: ActionRowBuilder<ButtonBuilder | StringSelectMenuBuilder>[] = [];
  const pageMembers = members.slice(page * MEMBERS_PER_PAGE, (page + 1) * MEMBERS_PER_PAGE);

  if (pageMembers.length > 0) {
    const select = new StringSelectMenuBuilder()
      .setCustomId(`${IDS.select}|${page}`)
      .setPlaceholder("Select members to check in / เลือกสมาชิกที่จะเช็คอิน")
      .setMinValues(1)
      .setMaxValues(pageMembers.length)
      .addOptions(pageMembers.map((m) => ({ label: m.characterName.slice(0, 100), value: m.memberId })));
    rows.push(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select));
  }

  const navRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`${IDS.page}|${page - 1}`).setLabel("◀ Prev").setStyle(ButtonStyle.Primary).setDisabled(page <= 0),
    new ButtonBuilder().setCustomId(IDS.refresh).setLabel("🔄 Refresh").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`${IDS.page}|${page + 1}`).setLabel("Next ▶").setStyle(ButtonStyle.Primary).setDisabled(page >= totalPages - 1)
  );
  if (members.length > 0) rows.push(navRow);

  return { embeds: [embed], components: rows };
}

export async function buildCheckinPanelPage(attendanceService: AttendanceService, page: number, justChecked?: string[]) {
  const members = await attendanceService.getMembersNeedingCheckIn();
  const totalPages = Math.max(1, Math.ceil(members.length / MEMBERS_PER_PAGE));
  const clampedPage = Math.min(Math.max(page, 0), totalPages - 1);
  return buildContent(members, clampedPage, totalPages, justChecked);
}

export function isCheckinPanelButton(customId: string): boolean {
  return customId.startsWith(`${IDS.page}|`) || customId === IDS.refresh;
}

export function isCheckinPanelSelectMenu(customId: string): boolean {
  return customId.startsWith(`${IDS.select}|`);
}

export async function handleCheckinPanelButton(interaction: ButtonInteraction, attendanceService: AttendanceService): Promise<void> {
  if (!isAdminInteraction(interaction)) {
    await interaction.reply({ content: "❌ You don't have permission to use this.\n❌ คุณไม่มีสิทธิ์ใช้ปุ่มนี้", ephemeral: true });
    return;
  }

  // Ack within Discord's 3s window immediately — rebuilding the page does several sequential
  // Sheets reads and can be slow, which was previously causing "app didn't respond in time".
  await interaction.deferUpdate();

  const [prefix, arg] = interaction.customId.split("|");
  const targetPage = prefix === IDS.page ? parseInt(arg, 10) || 0 : 0;
  const content = await buildCheckinPanelPage(attendanceService, targetPage);
  await interaction.editReply(content);
}

export async function handleCheckinPanelSelectMenu(interaction: StringSelectMenuInteraction, attendanceService: AttendanceService): Promise<void> {
  if (!isAdminInteraction(interaction)) {
    await interaction.reply({ content: "❌ You don't have permission to use this.\n❌ คุณไม่มีสิทธิ์ใช้เมนูนี้", ephemeral: true });
    return;
  }

  await interaction.deferUpdate();

  const [, pageArg] = interaction.customId.split("|");
  const page = parseInt(pageArg, 10) || 0;

  const justChecked: string[] = [];
  for (const memberId of interaction.values) {
    try {
      const result = await attendanceService.checkInMember(memberId);
      justChecked.push(result.characterName);
    } catch (error) {
      console.error(`ERROR Checkin panel select failed for ${memberId}`, error);
    }
  }

  const content = await buildCheckinPanelPage(attendanceService, page, justChecked);
  await interaction.editReply(content);
}
