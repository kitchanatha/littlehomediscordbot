import { Client, GatewayIntentBits } from "discord.js";
import { env } from "../config/env.js";

const intents: GatewayIntentBits[] = [GatewayIntentBits.Guilds];

if (env.ENABLE_MEMBERS_INTENT) {
  intents.push(GatewayIntentBits.GuildMembers);
}

export const discordClient = new Client({
  intents,
});
