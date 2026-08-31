import { REST, Routes } from "discord.js";
import { env } from "./config/env.js";
import { commandDefinitions } from "./commands/definitions.js";

const rest = new REST({ version: "10" }).setToken(env.DISCORD_TOKEN);
await rest.put(Routes.applicationGuildCommands(env.DISCORD_CLIENT_ID, env.DISCORD_GUILD_ID), {
  body: commandDefinitions,
});
console.log(`Registered ${commandDefinitions.length} guild slash commands.`);
