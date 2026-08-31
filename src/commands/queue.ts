import { ChatInputCommandInteraction, EmbedBuilder, GuildMember } from "discord.js";
import { QueueService } from "../services/queue-service.js";
import { QueueType } from "../types/queue.js";
import { UserError } from "../services/member-service.js";
import { env } from "../config/env.js";
import type { ClassService } from "../services/class-service.js";

export async function handleQueueJoin(interaction: ChatInputCommandInteraction, service: QueueService) {
  const type = interaction.options.getString("type", true) as QueueType;
  const discordId = interaction.user.id;

  try {
    const entry = await service.enqueue({
      targetDiscordId: discordId,
      queueType: type,
      changedByDiscordId: discordId,
    });

    await interaction.editReply({
      content: `✅ Joined ${type} queue.\nPosition: #${entry.position}`,
    });
  } catch (error: any) {
    if (error instanceof UserError) {
      await interaction.editReply({ content: error.message });
    } else {
      console.error(error);
      await interaction.editReply({ content: "❌ An error occurred while joining the queue." });
    }
  }
}

export async function handleQueueLeave(interaction: ChatInputCommandInteraction, service: QueueService) {
  const type = interaction.options.getString("type", true) as QueueType;
  const discordId = interaction.user.id;

  try {
    const result = await service.dequeue({
      targetDiscordId: discordId,
      queueType: type,
      changedByDiscordId: discordId,
    });

    const cooldownDate = new Date(result.cooldownUntil);
    await interaction.editReply({
      content: `✅ Left ${type} queue.\nYou can join this queue again after ${cooldownDate.toLocaleString()}.`,
    });
  } catch (error: any) {
    if (error instanceof UserError) {
      await interaction.editReply({ content: error.message });
    } else {
      console.error(error);
      await interaction.editReply({ content: "❌ An error occurred while leaving the queue." });
    }
  }
}

export async function handleQueueStatus(
  interaction: ChatInputCommandInteraction,
  service: QueueService,
  classService: ClassService
) {
  const discordId = interaction.user.id;
  const member = await service.getMemberByDiscordId(discordId);
  const display = member ? await classService.formatPlayerDisplay(member) : null;
  const displayName = display?.text || interaction.user.username;

  try {
    const status = await service.getMemberQueueStatus(discordId);
    const lines: string[] = [`📋 **Queue Status for ${displayName}**`];

    // Card
    if (status.card) {
      if (status.card.position) {
        lines.push(`🃏 **Card**: Position #${status.card.position} (Queued: ${new Date(status.card.queuedAt).toLocaleString()})`);
      } else if (status.card.cooldownUntil) {
        lines.push(`🃏 **Card**: Cooldown until ${new Date(status.card.cooldownUntil).toLocaleString()}`);
      }
    } else {
      lines.push("🃏 **Card**: Not queued");
    }

    // Accessory
    if (status.accessory) {
      if (status.accessory.position) {
        lines.push(`💍 **Accessory**: Position #${status.accessory.position} (Queued: ${new Date(status.accessory.queuedAt).toLocaleString()})`);
      } else if (status.accessory.cooldownUntil) {
        lines.push(`💍 **Accessory**: Cooldown until ${new Date(status.accessory.cooldownUntil).toLocaleString()}`);
      }
    } else {
      lines.push("💍 **Accessory**: Not queued");
    }

    await interaction.editReply({ content: lines.join("\n") });
  } catch (error) {
    console.error(error);
    await interaction.editReply({ content: "❌ An error occurred while fetching your status." });
  }
}

export async function handleQueueList(interaction: ChatInputCommandInteraction, service: QueueService) {
  const type = interaction.options.getString("type", true) as QueueType;

  try {
    const list = await service.getQueue(type);
    const emoji = type === "Card" ? "🃏" : "💍";
    const embed = new EmbedBuilder()
      .setTitle(`${emoji} ${type} Queue`)
      .setColor(type === "Card" ? 0x0099ff : 0xffcc00);

    if (list.length === 0) {
      embed.setDescription("The queue is currently empty.");
    } else {
      const description = list
        .map((e) => `${e.position}. ${e.text} (${e.className})`)
        .join("\n");
      embed.setDescription(description);
      embed.setFooter({ text: `Total: ${list.length}` });
    }

    await interaction.editReply({ embeds: [embed] });
  } catch (error) {
    console.error(error);
    await interaction.editReply({ content: "❌ An error occurred while fetching the queue list." });
  }
}

export async function handleQueueAdd(interaction: ChatInputCommandInteraction, service: QueueService) {
  const member = interaction.options.getMember("member") as GuildMember;
  const type = interaction.options.getString("type", true) as QueueType;

  const callerRoles = (interaction.member as GuildMember).roles.cache;
  const hasPermission = env.ASSIGN_ROLE_IDS.some((roleId) => callerRoles.has(roleId));

  if (!hasPermission) {
    await interaction.editReply({ content: "❌ You don't have permission to manage another member's queue." });
    return;
  }

  try {
    const entry = await service.enqueue({
      targetDiscordId: member.id,
      queueType: type,
      changedByDiscordId: interaction.user.id,
    });

    await interaction.editReply({
      content: `✅ Added ${member.user.toString()} to ${type} queue.\nPosition: #${entry.position}`,
    });
  } catch (error: any) {
    if (error instanceof UserError) {
      await interaction.editReply({ content: error.message });
    } else {
      console.error(error);
      await interaction.editReply({ content: "❌ An error occurred while adding to the queue." });
    }
  }
}

export async function handleQueueRemove(interaction: ChatInputCommandInteraction, service: QueueService) {
  const member = interaction.options.getMember("member") as GuildMember;
  const type = interaction.options.getString("type", true) as QueueType;

  const callerRoles = (interaction.member as GuildMember).roles.cache;
  const hasPermission = env.ASSIGN_ROLE_IDS.some((roleId) => callerRoles.has(roleId));

  if (!hasPermission) {
    await interaction.editReply({ content: "❌ You don't have permission to manage another member's queue." });
    return;
  }

  try {
    const result = await service.dequeue({
      targetDiscordId: member.id,
      queueType: type,
      changedByDiscordId: interaction.user.id,
    });

    const cooldownDate = new Date(result.cooldownUntil);
    await interaction.editReply({
      content: `✅ Removed ${member.user.toString()} from ${type} queue.\nCooldown until: ${cooldownDate.toLocaleString()}`,
    });
  } catch (error: any) {
    if (error instanceof UserError) {
      await interaction.editReply({ content: error.message });
    } else {
      console.error(error);
      await interaction.editReply({ content: "❌ An error occurred while removing from the queue." });
    }
  }
}
