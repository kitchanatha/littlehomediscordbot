import { Events, MessageFlags } from "discord.js";
import { handleAssign } from "./commands/assign.js";
import { handleHelp } from "./commands/help.js";
import { handlePanelButton, handlePanelModalSubmit, handlePanelSelectMenu } from "./discord/member-panel.js";
import { handleClass } from "./commands/class.js";
import { handleHistory } from "./commands/history.js";
import { handleName } from "./commands/name.js";
import { handleNameClass } from "./commands/name-class.js";
import { handleProfile } from "./commands/profile.js";
import { handleRegister } from "./commands/register.js";
import { handleRegisterAll } from "./commands/register-all.js";
import { handleWarRoster } from "./commands/war-roster.js";
import { handleQueueAdd, handleQueueJoin, handleQueueLeave, handleQueueList, handleQueueRemove, handleQueueStatus } from "./commands/queue.js";
import { handleWarCheckin } from "./commands/war-checkin.js";
import { handleWarLeave } from "./commands/war-leave.js";
import { handleWarCheckinPanel } from "./commands/war-checkin-panel.js";
import { handleCheckinPanelButton, isCheckinPanelButton } from "./discord/checkin-panel.js";
import { env } from "./config/env.js";
import { discordClient } from "./discord/client.js";
import { GoogleSheetsMemberRepository } from "./repositories/google-sheets-member-repository.js";
import { GoogleSheetsQueueRepository } from "./repositories/google-sheets-queue-repository.js";
import { GoogleSheetsAttendanceRepository } from "./repositories/google-sheets-attendance-repository.js";
import { MemberService, UserError } from "./services/member-service.js";
import { ClassService } from "./services/class-service.js";
import { QueueService } from "./services/queue-service.js";
import { WarRosterService } from "./services/war-roster-service.js";
import { SheetDisplayService } from "./services/sheet-display-service.js";
import { AttendanceService } from "./services/attendance-service.js";
import { GoogleSheetsDisplayRepository } from "./repositories/display-repository.js";
import { parseCharacterForm, resolveClassName } from "./utils/character-form-parser.js";
import { parseNameClassChange } from "./utils/name-class-change-parser.js";

const repository = new GoogleSheetsMemberRepository();
const classService = new ClassService(repository);
const displayRepository = new GoogleSheetsDisplayRepository();
const sheetDisplayService = new SheetDisplayService(repository, displayRepository, classService);
const queueRepository = new GoogleSheetsQueueRepository();
const queueService = new QueueService(queueRepository, repository, classService);
const warRosterService = new WarRosterService(repository, classService);
const attendanceRepository = new GoogleSheetsAttendanceRepository();
const attendanceService = new AttendanceService(attendanceRepository, repository);
const service = new MemberService(repository, classService, sheetDisplayService, queueService, attendanceService);

try {
  console.log("INFO Validating Google Sheets database readiness...");
  await repository.validateReadiness();
  await queueRepository.validateReadiness();
  console.log("✅ Database readiness verified");
} catch (error) {
  console.error("FATAL Database validation failed", error instanceof Error ? error.message : error);
  process.exit(1);
}

// Attendance is validated separately and non-fatally: an existing deployment can pick up
// this update before the guild's attendance sheet is renamed/created, without the bot refusing to start.
try {
  await attendanceRepository.validateReadiness();
} catch (error) {
  console.error("WARN Attendance database is not ready yet — /war_checkin and /war_leave will fail until it is.", error instanceof Error ? error.message : error);
}

discordClient.once(Events.ClientReady, async (readyClient) => {
  console.log(`INFO Bot ready as ${readyClient.user.tag}`);

  if (env.ENABLE_MEMBERS_INTENT) {
    try {
      console.log("INFO Starting member reconciliation...");
      const guild = await readyClient.guilds.fetch(env.DISCORD_GUILD_ID);
      const members = await guild.members.fetch();
      const { leftCount } = await service.reconcileMembers(Array.from(members.keys()));
      console.log(`✅ Reconciliation finished. Marked ${leftCount} members as Left.`);
    } catch (error) {
      console.error("ERROR Reconciliation failed", error instanceof Error ? error.message : error);
    }
  }
});

discordClient.on(Events.GuildMemberRemove, async (member) => {
  if (member.guild.id !== env.DISCORD_GUILD_ID) return;
  console.log(`INFO Member left guild: ${member.user.tag} (${member.id})`);

  try {
    const removedMember = await service.handleGuildMemberRemove(member.id);
    if (removedMember && env.MEMBER_UPDATE_CHANNEL_ID) {
      await announceMemberLeft(removedMember.characterName);
    }
  } catch (err) {
    console.error(`ERROR Failed to handle guildMemberRemove for ${member.id}`, err);
  }
});

async function announceMemberLeft(characterName: string): Promise<void> {
  try {
    const channel = await discordClient.channels.fetch(env.MEMBER_UPDATE_CHANNEL_ID);
    if (!channel || !channel.isTextBased() || !("send" in channel)) return;
    await channel.send(
      `👋 **${characterName}** has left the Discord server and is now marked as Left in the guild roster.\n👋 **${characterName}** ออกจากดิสคอร์ดแล้ว และถูกทำเครื่องหมายว่าออกจากกิลด์`
    );
  } catch (err) {
    console.error("ERROR Failed to post member-left announcement", err);
  }
}

discordClient.on(Events.GuildMemberAdd, async (member) => {
  if (member.guild.id !== env.DISCORD_GUILD_ID) return;
  console.log(`INFO Member joined guild: ${member.user.tag} (${member.id})`);
  await service.handleGuildMemberAdd(member.id, member.user.username).catch((err) => {
    console.error(`ERROR Failed to handle guildMemberAdd for ${member.id}`, err);
  });
});

discordClient.on(Events.VoiceStateUpdate, async (oldState, newState) => {
  if (env.WAR_CHECKIN_VOICE_CHANNEL_IDS.length === 0) return;
  if (newState.member?.user.bot) return;

  const joinedChannelId = newState.channelId;
  if (!joinedChannelId || !env.WAR_CHECKIN_VOICE_CHANNEL_IDS.includes(joinedChannelId)) return;
  if (oldState.channelId === newState.channelId) return; // not an actual join (e.g. mute/deafen toggle)

  try {
    const result = await attendanceService.checkIn(newState.id);
    console.log(`INFO Auto check-in via voice: ${result.characterName} marked present for ${result.dateLabel}`);
  } catch (error) {
    if (error instanceof UserError) {
      // Not registered yet — record it separately so it can be replayed under their real
      // name/class once they do register (see AttendanceService.reconcilePendingAttendance).
      const displayName = newState.member?.displayName ?? newState.member?.user.username ?? newState.id;
      try {
        await attendanceService.checkInUnregistered(newState.id, displayName);
        console.log(`INFO Auto check-in pending for unregistered ${displayName} (${newState.id})`);
      } catch (pendingError) {
        console.error(`ERROR Failed to record pending check-in for ${newState.id}`, pendingError);
      }
    } else {
      console.error(`ERROR Auto check-in failed for ${newState.id}`, error);
    }
  }
});

// Members post the guild's registration-form template in this channel; the bot registers
// them from it automatically. Silent by design: parse/validation failures are only logged,
// never posted back to the channel (this session's product decision, not a Discord API limit).
discordClient.on(Events.MessageCreate, async (message) => {
  if (!env.AUTO_REGISTER_CHANNEL_ID) return;
  if (message.channelId !== env.AUTO_REGISTER_CHANNEL_ID) return;
  if (message.author.bot) return;

  const { characterName, rawClass } = parseCharacterForm(message.content);
  if (!characterName || !rawClass) {
    console.log(`INFO Auto-register skipped for ${message.author.id}: message did not match the registration form`);
    return;
  }

  try {
    const activeClasses = await classService.getActiveClasses();
    const className = resolveClassName(rawClass, activeClasses);
    if (!className) {
      console.log(`INFO Auto-register skipped for ${message.author.id}: could not resolve class "${rawClass}"`);
      return;
    }

    const result = await service.register({
      discordId: message.author.id,
      discordUsername: message.author.username,
      characterName,
      className,
    });
    console.log(`INFO Auto-registered ${message.author.id} as ${result.member.characterName} (${result.member.className})`);
  } catch (error) {
    if (error instanceof UserError) {
      console.log(`INFO Auto-register skipped for ${message.author.id}: ${error.message}`);
    } else {
      console.error(`ERROR Auto-register failed for ${message.author.id}`, error);
    }
  }
});

// Members post a name/class change request in this channel; the bot applies it to their own
// registered profile automatically (self-service only — never someone else's profile).
// Silent by design, same as auto-register: parse/validation failures are only logged.
discordClient.on(Events.MessageCreate, async (message) => {
  if (!env.NAME_CLASS_CHANGE_CHANNEL_ID) return;
  if (message.channelId !== env.NAME_CLASS_CHANGE_CHANNEL_ID) return;
  if (message.author.bot) return;

  const activeClasses = await classService.getActiveClasses();
  const result = parseNameClassChange(message.content, activeClasses);

  if (result.ambiguousMultipleTargets) {
    console.log(`INFO Name/class change skipped for ${message.author.id}: message reports changes for multiple targets, can't tell which is the poster's own`);
    return;
  }
  if (!result.newName && !result.newClass) {
    if (result.unresolvedClass) {
      console.log(`INFO Name/class change skipped for ${message.author.id}: could not resolve class "${result.unresolvedClass}"`);
    }
    return; // not a change-request message at all
  }

  try {
    const updateResult = await service.updateNameAndClass({
      targetDiscordId: message.author.id,
      newName: result.newName ?? undefined,
      newClass: result.newClass ?? undefined,
      changedByDiscordId: message.author.id,
    });
    console.log(
      `INFO Name/class change applied for ${message.author.id}: nameChanged=${updateResult.nameChanged} classChanged=${updateResult.classChanged} -> ${updateResult.member.characterName} (${updateResult.member.className})`
    );
  } catch (error) {
    if (error instanceof UserError) {
      console.log(`INFO Name/class change skipped for ${message.author.id}: ${error.message}`);
    } else {
      console.error(`ERROR Name/class change failed for ${message.author.id}`, error);
    }
  }
});

discordClient.on(Events.InteractionCreate, async (interaction) => {
  if (interaction.isAutocomplete()) {
    const focusedValue = interaction.options.getFocused().toLowerCase();
    const classes = await service.getActiveClasses();
    const filtered = classes
      .filter((c) => c.toLowerCase().includes(focusedValue))
      .slice(0, 25);
    await interaction.respond(filtered.map((c) => ({ name: c, value: c })));
    return;
  }

  if (interaction.isButton()) {
    try {
      if (isCheckinPanelButton(interaction.customId)) {
        await handleCheckinPanelButton(interaction, attendanceService);
      } else {
        await handlePanelButton(interaction, queueService, classService, attendanceService);
      }
    } catch (error) {
      console.error("ERROR Panel button failed", error);
    }
    return;
  }

  if (interaction.isStringSelectMenu()) {
    try {
      await handlePanelSelectMenu(interaction);
    } catch (error) {
      console.error("ERROR Panel select menu failed", error);
    }
    return;
  }

  if (interaction.isModalSubmit()) {
    try {
      await handlePanelModalSubmit(interaction, service, classService);
    } catch (error) {
      console.error("ERROR Panel modal submit failed", error);
    }
    return;
  }

  if (!interaction.isChatInputCommand()) return;

  const isPublic = ["war_roster", "queue_list", "war_checkin_panel"].includes(interaction.commandName);

  try {
    await interaction.deferReply({ flags: isPublic ? undefined : MessageFlags.Ephemeral });

    switch (interaction.commandName) {
      case "help":
        await handleHelp(interaction);
        break;
      case "register":
        await handleRegister(interaction, service, classService);
        break;
      case "register_all":
        await handleRegisterAll(interaction, service);
        break;
      case "profile":
        await handleProfile(interaction, service, classService);
        break;
      case "name":
        await handleName(interaction, service, classService);
        break;
      case "name_class":
        await handleNameClass(interaction, service, classService);
        break;
      case "class":
        await handleClass(interaction, service, classService);
        break;
      case "history":
        await handleHistory(interaction, service, classService);
        break;
      case "assign":
        await handleAssign(interaction, service);
        break;
      case "war_roster":
        await handleWarRoster(interaction, warRosterService);
        break;
      case "queue_join":
        await handleQueueJoin(interaction, queueService);
        break;
      case "queue_leave":
        await handleQueueLeave(interaction, queueService);
        break;
      case "queue_status":
        await handleQueueStatus(interaction, queueService, classService);
        break;
      case "queue_list":
        await handleQueueList(interaction, queueService);
        break;
      case "queue_add":
        await handleQueueAdd(interaction, queueService);
        break;
      case "queue_remove":
        await handleQueueRemove(interaction, queueService);
        break;
      case "war_checkin":
        await handleWarCheckin(interaction, attendanceService);
        break;
      case "war_leave":
        await handleWarLeave(interaction, attendanceService);
        break;
      case "war_checkin_panel":
        await handleWarCheckinPanel(interaction, attendanceService);
        break;
    }
  } catch (error) {
    console.error("ERROR Command failed", error instanceof Error ? error.message : error);
    // If deferReply itself failed (e.g. Discord double-delivered the interaction), the
    // interaction was never acknowledged and editReply would throw again — nothing more to do.
    if (!interaction.deferred && !interaction.replied) return;

    const message =
      error instanceof UserError
        ? error.message
        : "❌ Something went wrong while accessing the guild database. Please try again later.";
    await interaction.editReply(message).catch((replyError) => {
      console.error("ERROR Failed to report command error to user", replyError);
    });
  }
});

// Without this, any unhandled error discord.js routes to the client's 'error' event
// (e.g. a REST failure during an interaction reply) crashes the whole process instead
// of just failing that one interaction.
discordClient.on(Events.Error, (error) => {
  console.error("ERROR Discord client error", error);
});

await discordClient.login(env.DISCORD_TOKEN);
