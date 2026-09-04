import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonInteraction,
  ButtonStyle,
  EmbedBuilder,
  ModalBuilder,
  ModalSubmitInteraction,
  StringSelectMenuBuilder,
  StringSelectMenuInteraction,
  TextInputBuilder,
  TextInputStyle,
} from "discord.js";
import { MemberService, UserError } from "../services/member-service.js";
import type { AttendanceService } from "../services/attendance-service.js";
import type { ClassService } from "../services/class-service.js";
import type { QueueService } from "../services/queue-service.js";

// Persistent button panel posted once into a channel (see src/scripts/post-member-panel.ts) so
// members can register, update their profile, and join a queue without typing a slash command.
// customIds are fixed strings — buttons/menus keep working across bot restarts as long as this
// file's handlers stay wired up in index.ts, no dependency on the original interaction staying
// "live".
//
// Discord modals can only contain text fields, not dropdowns — so class selection can't live
// inside the same modal as the character name. Flow instead goes: button click -> a real
// dropdown (StringSelectMenu) of classes -> picking one opens a modal for just the name. The
// chosen class is threaded through via the modal's customId (`...|<className>`), not any
// server-side session state.
const SKIP_CLASS = "__SKIP__";

export const PANEL_BUTTON_IDS = {
  register: "panel_register",
  nameClass: "panel_name_class",
  queueCard: "panel_queue_card",
  queueAccessory: "panel_queue_accessory",
  queueLeave: "panel_queue_leave",
  warCheckin: "panel_war_checkin",
  warLeave: "panel_war_leave",
} as const;

const SELECT_IDS = {
  registerClass: "panel_select_register_class",
  nameClassClass: "panel_select_nameclass_class",
} as const;

const MODAL_PREFIX = {
  register: "panel_modal_register",
  nameClass: "panel_modal_name_class",
} as const;

const FIELD_IDS = {
  characterName: "character_name",
  newName: "new_name",
} as const;

export function buildMemberPanelMessage() {
  const embed = new EmbedBuilder()
    .setTitle("📋 Guild Member Panel / แผงควบคุมสมาชิกกิลด์")
    .setColor(0x5865f2)
    .setDescription(
      [
        "**Register** — first-time registration / ลงทะเบียนครั้งแรก",
        "**Change Name/Class** — update your existing profile / แก้ไขชื่อหรืออาชีพของคุณ",
        "**Card Queue** / **Accessory Queue** — join that queue directly / เข้าคิวการ์ดหรือคิวประดับโดยตรง",
        "**ได้รับของประมูลแล้ว** — leave the queue once you've received your item / ออกจากคิวเมื่อได้รับของแล้ว",
        "**War Check-in** — mark yourself present for today's War / เช็คอินวอร์วันนี้ด้วยตัวเอง",
        "**War Leave** — let the guild know you can't make today's War / แจ้งลาวอร์วันนี้",
        "**ประมูลของ** — open the item auction site / เปิดเว็บประมูลไอเทม",
      ].join("\n")
    );

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(PANEL_BUTTON_IDS.register).setLabel("Register").setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(PANEL_BUTTON_IDS.nameClass).setLabel("Change Name/Class").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(PANEL_BUTTON_IDS.queueCard).setLabel("Card Queue").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(PANEL_BUTTON_IDS.queueAccessory).setLabel("Accessory Queue").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(PANEL_BUTTON_IDS.queueLeave).setLabel("🎁 ได้รับของประมูลแล้ว").setStyle(ButtonStyle.Secondary)
  );
  const row2 = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(PANEL_BUTTON_IDS.warCheckin).setLabel("✅ War Check-in").setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(PANEL_BUTTON_IDS.warLeave).setLabel("😷 War Leave").setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setLabel("🔨 ประมูลของ").setStyle(ButtonStyle.Link).setURL("https://kitchanatha.github.io/guild-item-reservation/")
  );

  return { embeds: [embed], components: [row, row2] };
}

export function buildWarCheckinOnlyMessage() {
  const embed = new EmbedBuilder()
    .setTitle("✅ War Check-in / เช็คอินวอร์")
    .setColor(0x57f287)
    .setDescription("Click below to mark yourself present for today's War.\nคลิกด้านล่างเพื่อเช็คอินวอร์วันนี้");
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(PANEL_BUTTON_IDS.warCheckin).setLabel("✅ War Check-in").setStyle(ButtonStyle.Success)
  );
  return { embeds: [embed], components: [row] };
}

export function buildWarLeaveOnlyMessage() {
  const embed = new EmbedBuilder()
    .setTitle("😷 War Leave / แจ้งลาวอร์")
    .setColor(0xed4245)
    .setDescription("Click below to let the guild know you can't make today's War.\nคลิกด้านล่างเพื่อแจ้งลาวอร์วันนี้");
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(PANEL_BUTTON_IDS.warLeave).setLabel("😷 War Leave").setStyle(ButtonStyle.Danger)
  );
  return { embeds: [embed], components: [row] };
}

export function buildRegisterOnlyMessage() {
  const embed = new EmbedBuilder()
    .setTitle("📝 Register / ลงทะเบียน")
    .setColor(0x57f287)
    .setDescription("Click below to register your character for the first time.\nคลิกด้านล่างเพื่อลงทะเบียนครั้งแรก");
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(PANEL_BUTTON_IDS.register).setLabel("Register").setStyle(ButtonStyle.Success)
  );
  return { embeds: [embed], components: [row] };
}

export function buildNameClassOnlyMessage() {
  const embed = new EmbedBuilder()
    .setTitle("✏️ Change Name/Class / แก้ไขชื่อหรืออาชีพ")
    .setColor(0x5865f2)
    .setDescription("Click below to update your character name and/or class.\nคลิกด้านล่างเพื่อแก้ไขชื่อหรืออาชีพของคุณ");
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(PANEL_BUTTON_IDS.nameClass).setLabel("Change Name/Class").setStyle(ButtonStyle.Primary)
  );
  return { embeds: [embed], components: [row] };
}

export function buildQueueOnlyMessage() {
  const embed = new EmbedBuilder()
    .setTitle("🎟️ Item Queue / คิวไอเทม")
    .setColor(0x5865f2)
    .setDescription(
      [
        "**Card Queue** / **Accessory Queue** — join that queue / เข้าคิวการ์ดหรือคิวประดับ",
        "**ได้รับของประมูลแล้ว** — leave the queue once you've received your item / ออกจากคิวเมื่อได้รับของแล้ว",
      ].join("\n")
    );
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(PANEL_BUTTON_IDS.queueCard).setLabel("Card Queue").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(PANEL_BUTTON_IDS.queueAccessory).setLabel("Accessory Queue").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(PANEL_BUTTON_IDS.queueLeave).setLabel("🎁 ได้รับของประมูลแล้ว").setStyle(ButtonStyle.Success)
  );
  return { embeds: [embed], components: [row] };
}

export function buildAuctionOnlyMessage() {
  const embed = new EmbedBuilder()
    .setTitle("🔨 ประมูลของ / Item Auction")
    .setColor(0xfee75c)
    .setDescription("Click below to open the item auction site.\nคลิกด้านล่างเพื่อเปิดเว็บประมูลไอเทม");
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setLabel("🔨 ประมูลของ").setStyle(ButtonStyle.Link).setURL("https://kitchanatha.github.io/guild-item-reservation/")
  );
  return { embeds: [embed], components: [row] };
}

function nameModal(customId: string, title: string, label: string, required: boolean): ModalBuilder {
  const input = new TextInputBuilder()
    .setCustomId(FIELD_IDS.characterName)
    .setLabel(label)
    .setStyle(TextInputStyle.Short)
    .setRequired(required)
    .setMaxLength(50);
  return new ModalBuilder().setCustomId(customId).setTitle(title).addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(input));
}

export async function handlePanelButton(
  interaction: ButtonInteraction,
  queueService: QueueService,
  classService: ClassService,
  attendanceService: AttendanceService
): Promise<void> {
  switch (interaction.customId) {
    case PANEL_BUTTON_IDS.register: {
      const classes = await classService.getActiveClasses();
      const menu = new StringSelectMenuBuilder()
        .setCustomId(SELECT_IDS.registerClass)
        .setPlaceholder("Select your class / เลือกอาชีพของคุณ")
        .addOptions(classes.map((c) => ({ label: c, value: c })));
      await interaction.reply({
        content: "Step 1/2 — pick your class / เลือกอาชีพของคุณ",
        components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu)],
        ephemeral: true,
      });
      return;
    }
    case PANEL_BUTTON_IDS.nameClass: {
      const classes = await classService.getActiveClasses();
      const menu = new StringSelectMenuBuilder()
        .setCustomId(SELECT_IDS.nameClassClass)
        .setPlaceholder("Select a new class, or skip / เลือกอาชีพใหม่ หรือข้าม")
        .addOptions(
          { label: "— Keep current class / ไม่เปลี่ยนอาชีพ —", value: SKIP_CLASS },
          ...classes.map((c) => ({ label: c, value: c }))
        );
      await interaction.reply({
        content: "Step 1/2 — change class (optional) / เปลี่ยนอาชีพ (ไม่บังคับ)",
        components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu)],
        ephemeral: true,
      });
      return;
    }
    case PANEL_BUTTON_IDS.queueCard:
    case PANEL_BUTTON_IDS.queueAccessory: {
      await interaction.deferReply({ ephemeral: true });
      const queueType = interaction.customId === PANEL_BUTTON_IDS.queueCard ? "Card" : "Accessory";
      const discordId = interaction.user.id;
      try {
        const entry = await queueService.enqueue({ targetDiscordId: discordId, queueType, changedByDiscordId: discordId });
        await interaction.editReply(`✅ Joined ${queueType} queue.\nPosition: #${entry.position}`);
      } catch (error) {
        if (error instanceof UserError) {
          await interaction.editReply(error.message);
        } else {
          console.error("ERROR Panel queue join failed", error);
          await interaction.editReply("❌ Something went wrong. Please try again later.\n❌ เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง");
        }
      }
      return;
    }
    case PANEL_BUTTON_IDS.queueLeave: {
      await interaction.deferReply({ ephemeral: true });
      const discordId = interaction.user.id;
      try {
        const left = await queueService.leaveAllActiveQueues(discordId, discordId);
        if (left.length === 0) {
          await interaction.editReply("ℹ️ You're not currently in any queue.\nℹ️ คุณไม่ได้อยู่ในคิวใดๆ อยู่");
        } else {
          await interaction.editReply(
            `✅ Left the ${left.join(" and ")} queue${left.length > 1 ? "s" : ""}. Enjoy your item!\n✅ ออกจากคิว${left.join("และ")}แล้ว ยินดีด้วยนะ!`
          );
        }
      } catch (error) {
        if (error instanceof UserError) {
          await interaction.editReply(error.message);
        } else {
          console.error("ERROR Panel queue leave failed", error);
          await interaction.editReply("❌ Something went wrong. Please try again later.\n❌ เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง");
        }
      }
      return;
    }
    case PANEL_BUTTON_IDS.warCheckin: {
      await interaction.deferReply({ ephemeral: true });
      try {
        const result = await attendanceService.checkIn(interaction.user.id);
        await interaction.editReply(
          `✅ Checked in for War (${result.dateLabel}) as **${result.characterName}**.\n✅ เช็คอินวอร์ (${result.dateLabel}) ในชื่อ **${result.characterName}** แล้ว`
        );
      } catch (error) {
        if (error instanceof UserError) {
          await interaction.editReply(error.message);
        } else {
          console.error("ERROR Panel war check-in failed", error);
          await interaction.editReply("❌ Something went wrong. Please try again later.\n❌ เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง");
        }
      }
      return;
    }
    case PANEL_BUTTON_IDS.warLeave: {
      await interaction.deferReply({ ephemeral: true });
      try {
        const result = await attendanceService.requestLeave(interaction.user.id);
        await interaction.editReply(
          `✅ Leave recorded for **${result.characterName}** (${result.dateLabel}).\n✅ บันทึกการลาสำหรับ **${result.characterName}** แล้ว (${result.dateLabel})`
        );
      } catch (error) {
        if (error instanceof UserError) {
          await interaction.editReply(error.message);
        } else {
          console.error("ERROR Panel war leave failed", error);
          await interaction.editReply("❌ Something went wrong. Please try again later.\n❌ เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง");
        }
      }
      return;
    }
  }
}

export async function handlePanelSelectMenu(interaction: StringSelectMenuInteraction): Promise<void> {
  const chosen = interaction.values[0];

  if (interaction.customId === SELECT_IDS.registerClass) {
    await interaction.showModal(
      nameModal(`${MODAL_PREFIX.register}|${chosen}`, "Register / ลงทะเบียน", "Character Name / ชื่อตัวละคร", true)
    );
    return;
  }

  if (interaction.customId === SELECT_IDS.nameClassClass) {
    await interaction.showModal(
      nameModal(
        `${MODAL_PREFIX.nameClass}|${chosen}`,
        "Change Name/Class / แก้ไขชื่อหรืออาชีพ",
        "New Character Name (optional) / ชื่อใหม่",
        false
      )
    );
    return;
  }
}

export async function handlePanelModalSubmit(
  interaction: ModalSubmitInteraction,
  service: MemberService,
  classService: ClassService
): Promise<void> {
  const [prefix, chosenClass] = interaction.customId.split("|");

  if (prefix === MODAL_PREFIX.register) {
    await interaction.deferReply({ ephemeral: true });
    const discordId = interaction.user.id;
    const characterName = interaction.fields.getTextInputValue(FIELD_IDS.characterName);

    try {
      const result = await service.register({
        discordId,
        discordUsername: interaction.user.username,
        characterName,
        className: chosenClass,
      });
      const display = await classService.formatPlayerDisplay(result.member);
      const lines = [
        "✅ Registration complete!",
        `Character: **${display.text}**`,
        `Class: **${result.member.className}**`,
        `Team: **${result.member.team || "Not assigned"}**`,
        `Party: **${result.member.party || "Not assigned"}**`,
      ];
      lines.push(result.legacyLinked ? "ℹ️ Old guild data was linked automatically." : "ℹ️ No legacy record was found.");
      await interaction.editReply(lines.join("\n"));
      console.log(`INFO Member registered via panel: ${discordId}`);
    } catch (error) {
      if (error instanceof UserError) {
        await interaction.editReply(error.message);
      } else {
        console.error("ERROR Panel register failed", error);
        await interaction.editReply("❌ Something went wrong. Please try again later.\n❌ เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง");
      }
    }
    return;
  }

  if (prefix === MODAL_PREFIX.nameClass) {
    await interaction.deferReply({ ephemeral: true });
    const discordId = interaction.user.id;
    const newName = interaction.fields.getTextInputValue(FIELD_IDS.characterName).trim();
    const newClass = chosenClass === SKIP_CLASS ? undefined : chosenClass;

    try {
      const result = await service.updateNameAndClass({
        targetDiscordId: discordId,
        newName: newName || undefined,
        newClass,
        changedByDiscordId: discordId,
      });

      if (!result.nameChanged && !result.classChanged) {
        await interaction.editReply("ℹ️ No changes were needed.\nℹ️ ไม่มีข้อมูลที่ต้องเปลี่ยน");
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
      await interaction.editReply(messages.join("\n\n"));
      console.log(`INFO Profile updated via panel for ${discordId}`);
    } catch (error) {
      if (error instanceof UserError) {
        await interaction.editReply(error.message);
      } else {
        console.error("ERROR Panel name/class update failed", error);
        await interaction.editReply("❌ Something went wrong. Please try again later.\n❌ เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง");
      }
    }
  }
}
