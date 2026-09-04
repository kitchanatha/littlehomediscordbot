import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonInteraction,
  ButtonStyle,
  EmbedBuilder,
  ModalBuilder,
  ModalSubmitInteraction,
  TextInputBuilder,
  TextInputStyle,
} from "discord.js";
import { MemberService, UserError } from "../services/member-service.js";
import type { ClassService } from "../services/class-service.js";
import type { QueueService } from "../services/queue-service.js";

// Persistent button panel posted once into a channel (see src/scripts/post-member-panel.ts) so
// members can register, update their profile, and join a queue without typing a slash command.
// customIds are fixed strings — buttons keep working across bot restarts as long as this file's
// handlers stay wired up in index.ts, no dependency on the original interaction staying "live".
export const PANEL_BUTTON_IDS = {
  register: "panel_register",
  nameClass: "panel_name_class",
  queueCard: "panel_queue_card",
  queueAccessory: "panel_queue_accessory",
} as const;

const MODAL_IDS = {
  register: "panel_modal_register",
  nameClass: "panel_modal_name_class",
} as const;

const FIELD_IDS = {
  registerName: "register_name",
  registerClass: "register_class",
  newName: "new_name",
  newClass: "new_class",
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
      ].join("\n")
    );

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(PANEL_BUTTON_IDS.register).setLabel("Register").setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(PANEL_BUTTON_IDS.nameClass).setLabel("Change Name/Class").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(PANEL_BUTTON_IDS.queueCard).setLabel("Card Queue").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(PANEL_BUTTON_IDS.queueAccessory).setLabel("Accessory Queue").setStyle(ButtonStyle.Secondary)
  );

  return { embeds: [embed], components: [row] };
}

// Buttons that open a modal must call showModal() as the FIRST response — no deferReply first.
// Buttons that act immediately (the two queue joins) defer + edit like a normal slash command.
export async function handlePanelButton(
  interaction: ButtonInteraction,
  queueService: QueueService
): Promise<void> {
  switch (interaction.customId) {
    case PANEL_BUTTON_IDS.register: {
      const modal = new ModalBuilder().setCustomId(MODAL_IDS.register).setTitle("Register / ลงทะเบียน");
      const nameInput = new TextInputBuilder()
        .setCustomId(FIELD_IDS.registerName)
        .setLabel("Character Name / ชื่อตัวละคร")
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMaxLength(50);
      const classInput = new TextInputBuilder()
        .setCustomId(FIELD_IDS.registerClass)
        .setLabel("Class (e.g. Knight, Priest) / อาชีพ")
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMaxLength(30);
      modal.addComponents(
        new ActionRowBuilder<TextInputBuilder>().addComponents(nameInput),
        new ActionRowBuilder<TextInputBuilder>().addComponents(classInput)
      );
      await interaction.showModal(modal);
      return;
    }
    case PANEL_BUTTON_IDS.nameClass: {
      const modal = new ModalBuilder().setCustomId(MODAL_IDS.nameClass).setTitle("Change Name/Class / แก้ไขชื่อหรืออาชีพ");
      const nameInput = new TextInputBuilder()
        .setCustomId(FIELD_IDS.newName)
        .setLabel("New Character Name (optional) / ชื่อใหม่")
        .setStyle(TextInputStyle.Short)
        .setRequired(false)
        .setMaxLength(50);
      const classInput = new TextInputBuilder()
        .setCustomId(FIELD_IDS.newClass)
        .setLabel("New Class (optional) / อาชีพใหม่")
        .setStyle(TextInputStyle.Short)
        .setRequired(false)
        .setMaxLength(30);
      modal.addComponents(
        new ActionRowBuilder<TextInputBuilder>().addComponents(nameInput),
        new ActionRowBuilder<TextInputBuilder>().addComponents(classInput)
      );
      await interaction.showModal(modal);
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
  }
}

export async function handlePanelModalSubmit(
  interaction: ModalSubmitInteraction,
  service: MemberService,
  classService: ClassService
): Promise<void> {
  if (interaction.customId === MODAL_IDS.register) {
    await interaction.deferReply({ ephemeral: true });
    const discordId = interaction.user.id;
    const characterName = interaction.fields.getTextInputValue(FIELD_IDS.registerName);
    const className = interaction.fields.getTextInputValue(FIELD_IDS.registerClass);

    try {
      const result = await service.register({
        discordId,
        discordUsername: interaction.user.username,
        characterName,
        className,
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

  if (interaction.customId === MODAL_IDS.nameClass) {
    await interaction.deferReply({ ephemeral: true });
    const discordId = interaction.user.id;
    const newName = interaction.fields.getTextInputValue(FIELD_IDS.newName).trim();
    const newClass = interaction.fields.getTextInputValue(FIELD_IDS.newClass).trim();

    try {
      const result = await service.updateNameAndClass({
        targetDiscordId: discordId,
        newName: newName || undefined,
        newClass: newClass || undefined,
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
