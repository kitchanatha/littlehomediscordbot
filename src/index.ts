import { Events } from "discord.js";
import { handleClass } from "./commands/class.js";
import { handleHistory } from "./commands/history.js";
import { handleName } from "./commands/name.js";
import { handleProfile } from "./commands/profile.js";
import { handleRegister } from "./commands/register.js";
import { env } from "./config/env.js";
import { discordClient } from "./discord/client.js";
import { GoogleSheetsMemberRepository } from "./repositories/google-sheets-member-repository.js";
import { MemberService, UserError } from "./services/member-service.js";

const repository = new GoogleSheetsMemberRepository();
const service = new MemberService(repository);

discordClient.once(Events.ClientReady, (readyClient) => {
  console.log(`INFO Bot ready as ${readyClient.user.tag}`);
});

discordClient.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  await interaction.deferReply({ ephemeral: true });

  try {
    switch (interaction.commandName) {
      case "register":
        await handleRegister(interaction, service);
        break;
      case "profile":
        await handleProfile(interaction, service);
        break;
      case "name":
        await handleName(interaction, service);
        break;
      case "class":
        await handleClass(interaction, service);
        break;
      case "history":
        await handleHistory(interaction, service);
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
