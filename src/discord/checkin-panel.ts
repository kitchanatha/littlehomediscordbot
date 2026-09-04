import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonInteraction,
  ButtonStyle,
  EmbedBuilder,
  GuildMemberRoleManager,
  ModalBuilder,
  ModalSubmitInteraction,
  StringSelectMenuBuilder,
  StringSelectMenuInteraction,
  TextInputBuilder,
  TextInputStyle,
} from "discord.js";
import { env } from "../config/env.js";
import type { AttendanceService } from "../services/attendance-service.js";
import type { Member } from "../types/member.js";
import { coreName } from "../utils/normalize.js";

// Admin check-in checklist: /war_checkin_panel posts a list of everyone not yet marked present
// today. Three ways to check people in, so the admin can pick whichever fits the moment:
//   1. Multi-select dropdown (Discord's closest thing to a checkbox list) — pick several names,
//      confirms on close. Paginated at 25/page (Discord's own select-menu option cap).
//   2. "Sync from Voice" — one click checks in everyone currently connected to the configured
//      War voice channel(s) who isn't marked present yet. No selecting needed at all.
//   3. "Search" — type a partial name, get back a short filtered dropdown instead of paging
//      through the full list to find one person.
// The whole thing is one shared, non-ephemeral message so every admin watching the channel
// sees checks land in real time.
const MEMBERS_PER_PAGE = 25;

const IDS = {
  select: "checkin_select",
  page: "checkin_page",
  refresh: "checkin_refresh",
  syncVoice: "checkin_sync_voice",
  searchButton: "checkin_search_button",
  searchModal: "checkin_search_modal",
  searchInput: "checkin_search_input",
  searchSelect: "checkin_search_select",
} as const;

function isAdminInteraction(interaction: ButtonInteraction | StringSelectMenuInteraction | ModalSubmitInteraction): boolean {
  const roles = interaction.member?.roles;
  return roles instanceof GuildMemberRoleManager
    ? env.ASSIGN_ROLE_IDS.some((roleId) => roles.cache.has(roleId))
    : Array.isArray(roles) && env.ASSIGN_ROLE_IDS.some((roleId) => roles.includes(roleId));
}

function actionButtonsRow(): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(IDS.syncVoice).setLabel("🔄 Sync from Voice").setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(IDS.searchButton).setLabel("🔍 Search").setStyle(ButtonStyle.Secondary)
  );
}

function buildContent(members: Member[], page: number, totalPages: number, footerNote?: string) {
  const embed = new EmbedBuilder()
    .setTitle("✅ War Check-in Panel / เช็คอินวอร์")
    .setColor(0x57f287)
    .setDescription(
      members.length === 0
        ? "Everyone is checked in! / เช็คอินครบทุกคนแล้ว!"
        : [
            "**Dropdown** — select one or more names, confirms on close.",
            "**🔄 Sync from Voice** — check in everyone currently in the War voice channel.",
            "**🔍 Search** — filter the list by name.",
            "",
            `${members.length} still need checking in. / เหลืออีก ${members.length} คน`,
          ].join("\n")
    )
    .setFooter({ text: `Page ${page + 1}/${Math.max(totalPages, 1)}${footerNote ? ` — ${footerNote}` : ""}` });

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

  if (members.length > 0) {
    const navRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(`${IDS.page}|${page - 1}`).setLabel("◀ Prev").setStyle(ButtonStyle.Primary).setDisabled(page <= 0),
      new ButtonBuilder().setCustomId(IDS.refresh).setLabel("🔄 Refresh").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`${IDS.page}|${page + 1}`).setLabel("Next ▶").setStyle(ButtonStyle.Primary).setDisabled(page >= totalPages - 1)
    );
    rows.push(navRow);
  }
  rows.push(actionButtonsRow());

  return { embeds: [embed], components: rows };
}

function buildSearchResultsContent(query: string, matches: Member[]) {
  const embed = new EmbedBuilder()
    .setTitle("✅ War Check-in Panel / เช็คอินวอร์")
    .setColor(0x57f287)
    .setDescription(
      matches.length === 0
        ? `No matches for "${query}". / ไม่พบชื่อที่ตรงกับ "${query}"`
        : `Search results for "${query}" (${matches.length}) — select to check in.\nผลการค้นหา "${query}"`
    )
    .setFooter({ text: "Search results — use 🔄 Refresh to go back to the full list." });

  const rows: ActionRowBuilder<ButtonBuilder | StringSelectMenuBuilder>[] = [];
  if (matches.length > 0) {
    const select = new StringSelectMenuBuilder()
      .setCustomId(`${IDS.searchSelect}`)
      .setPlaceholder("Select members to check in / เลือกสมาชิกที่จะเช็คอิน")
      .setMinValues(1)
      .setMaxValues(Math.min(matches.length, 25))
      .addOptions(matches.slice(0, 25).map((m) => ({ label: m.characterName.slice(0, 100), value: m.memberId })));
    rows.push(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select));
  }
  rows.push(
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(IDS.refresh).setLabel("◀ Back to full list").setStyle(ButtonStyle.Primary)
    )
  );
  rows.push(actionButtonsRow());

  return { embeds: [embed], components: rows };
}

export async function buildCheckinPanelPage(attendanceService: AttendanceService, page: number, justChecked?: string[]) {
  const members = await attendanceService.getMembersNeedingCheckIn();
  const totalPages = Math.max(1, Math.ceil(members.length / MEMBERS_PER_PAGE));
  const clampedPage = Math.min(Math.max(page, 0), totalPages - 1);
  const footerNote = justChecked?.length ? `just checked in: ${justChecked.join(", ")}` : undefined;
  return buildContent(members, clampedPage, totalPages, footerNote);
}

export function isCheckinPanelButton(customId: string): boolean {
  return (
    customId.startsWith(`${IDS.page}|`) ||
    customId === IDS.refresh ||
    customId === IDS.syncVoice ||
    customId === IDS.searchButton
  );
}

export function isCheckinPanelSelectMenu(customId: string): boolean {
  return customId.startsWith(`${IDS.select}|`) || customId === IDS.searchSelect;
}

export function isCheckinPanelModal(customId: string): boolean {
  return customId === IDS.searchModal;
}

export async function handleCheckinPanelButton(interaction: ButtonInteraction, attendanceService: AttendanceService): Promise<void> {
  if (!isAdminInteraction(interaction)) {
    await interaction.reply({ content: "❌ You don't have permission to use this.\n❌ คุณไม่มีสิทธิ์ใช้ปุ่มนี้", ephemeral: true });
    return;
  }

  if (interaction.customId === IDS.searchButton) {
    const modal = new ModalBuilder()
      .setCustomId(IDS.searchModal)
      .setTitle("Search Members / ค้นหาสมาชิก")
      .addComponents(
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder()
            .setCustomId(IDS.searchInput)
            .setLabel("Name (or part of it) / ชื่อ (หรือบางส่วน)")
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
            .setMaxLength(50)
        )
      );
    await interaction.showModal(modal);
    return;
  }

  // Ack within Discord's 3s window immediately — rebuilding the page does several sequential
  // Sheets reads and can be slow, which was previously causing "app didn't respond in time".
  await interaction.deferUpdate();

  if (interaction.customId === IDS.syncVoice) {
    const voiceChannelIds = env.WAR_CHECKIN_VOICE_CHANNEL_IDS;
    if (voiceChannelIds.length === 0 || !interaction.guild) {
      await interaction.editReply(await buildCheckinPanelPage(attendanceService, 0));
      return;
    }
    const discordIds: string[] = [];
    for (const channelId of voiceChannelIds) {
      try {
        const channel = await interaction.guild.channels.fetch(channelId);
        if (channel?.isVoiceBased()) discordIds.push(...channel.members.map((m) => m.id));
      } catch (error) {
        console.error(`ERROR Sync-from-voice failed to fetch channel ${channelId}`, error);
      }
    }
    const checkedIn = await attendanceService.checkInMembersByDiscordIds(discordIds);
    const content = await buildCheckinPanelPage(
      attendanceService,
      0,
      checkedIn.length > 0 ? checkedIn : undefined
    );
    if (checkedIn.length === 0) {
      content.embeds[0].setFooter({ text: `${content.embeds[0].data.footer?.text ?? ""} — no one new to check in from voice` });
    }
    await interaction.editReply(content);
    return;
  }

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

  const justChecked: string[] = [];
  for (const memberId of interaction.values) {
    try {
      const result = await attendanceService.checkInMember(memberId);
      justChecked.push(result.characterName);
    } catch (error) {
      console.error(`ERROR Checkin panel select failed for ${memberId}`, error);
    }
  }

  const [, pageArg] = interaction.customId.split("|");
  const page = pageArg ? parseInt(pageArg, 10) || 0 : 0;
  const content = await buildCheckinPanelPage(attendanceService, page, justChecked);
  await interaction.editReply(content);
}

export async function handleCheckinPanelModalSubmit(interaction: ModalSubmitInteraction, attendanceService: AttendanceService): Promise<void> {
  if (!isAdminInteraction(interaction)) {
    await interaction.reply({ content: "❌ You don't have permission to use this.\n❌ คุณไม่มีสิทธิ์ใช้เมนูนี้", ephemeral: true });
    return;
  }

  await interaction.deferUpdate();

  const query = interaction.fields.getTextInputValue(IDS.searchInput).trim();
  const queryCore = coreName(query);
  const members = await attendanceService.getMembersNeedingCheckIn();
  const matches = members.filter((m) => coreName(m.characterName).includes(queryCore));

  await interaction.editReply(buildSearchResultsContent(query, matches));
}
