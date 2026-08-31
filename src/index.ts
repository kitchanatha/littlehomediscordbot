import { Events, MessageFlags } from "discord.js";
import { handleAssign } from "./commands/assign.js";
import { handleClass } from "./commands/class.js";
import { handleHistory } from "./commands/history.js";
import { handleName } from "./commands/name.js";
import { handleNameClass } from "./commands/name-class.js";
import { handleProfile } from "./commands/profile.js";
import { handleRegister } from "./commands/register.js";
import { handleRegisterAll } from "./commands/register-all.js";
import { handleWarRoster } from "./commands/war-roster.js";
import { handleQueueAdd, handleQueueJoin, handleQueueLeave, handleQueueList, handleQueueRemove, handleQueueStatus } from "./commands/queue.js";
import { env } from "./config/env.js";
import { discordClient } from "./discord/client.js";
import { GoogleSheetsMemberRepository } from "./repositories/google-sheets-member-repository.js";
import { GoogleSheetsQueueRepository } from "./repositories/google-sheets-queue-repository.js";
import { MemberService, UserError } from "./services/member-service.js";
import { ClassService } from "./services/class-service.js";
import { QueueService } from "./services/queue-service.js";
import { WarRosterService } from "./services/war-roster-service.js";
import { SheetDisplayService } from "./services/sheet-display-service.js";
import { GoogleSheetsDisplayRepository } from "./repositories/display-repository.js";

const repository = new GoogleSheetsMemberRepository();
const classService = new ClassService(repository);
const displayRepository = new GoogleSheetsDisplayRepository();
const sheetDisplayService = new SheetDisplayService(repository, displayRepository, classService);
const queueRepository = new GoogleSheetsQueueRepository();
const queueService = new QueueService(queueRepository, repository, classService);
const service = new MemberService(repository, classService, sheetDisplayService, queueService);
const warRosterService = new WarRosterService(repository, classService);

try {
  console.log("INFO Validating Google Sheets database readiness...");
  await repository.validateReadiness();
  await queueRepository.validateReadiness();
  console.log("✅ Database readiness verified");
} catch (error) {
  console.error("FATAL Database validation failed", error instanceof Error ? error.message : error);
  process.exit(1);
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
  await service.handleGuildMemberRemove(member.id).catch((err) => {
    console.error(`ERROR Failed to handle guildMemberRemove for ${member.id}`, err);
  });
});

discordClient.on(Events.GuildMemberAdd, async (member) => {
  if (member.guild.id !== env.DISCORD_GUILD_ID) return;
  console.log(`INFO Member joined guild: ${member.user.tag} (${member.id})`);
  await service.handleGuildMemberAdd(member.id, member.user.username).catch((err) => {
    console.error(`ERROR Failed to handle guildMemberAdd for ${member.id}`, err);
  });
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

  if (!interaction.isChatInputCommand()) return;

  const isPublic = ["war_roster", "queue_list"].includes(interaction.commandName);
  await interaction.deferReply({ flags: isPublic ? undefined : MessageFlags.Ephemeral });

  try {
    switch (interaction.commandName) {
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
    }
  } catch (error) {
    if (error instanceof UserError) {
      await interaction.editReply(error.message);
      return;
    }
    console.error("ERROR Command failed", error instanceof Error ? error.message : error);
    await interaction.editReply("❌ Something went wrong while accessing the guild database. Please try again later.");
  }
});

await discordClient.login(env.DISCORD_TOKEN);
