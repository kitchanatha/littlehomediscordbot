import { Client, GatewayIntentBits } from "discord.js";
import { env } from "../config/env.js";

const intents: GatewayIntentBits[] = [GatewayIntentBits.Guilds];

if (env.ENABLE_MEMBERS_INTENT) {
  intents.push(GatewayIntentBits.GuildMembers);
}

if (env.WAR_CHECKIN_VOICE_CHANNEL_IDS.length > 0) {
  intents.push(GatewayIntentBits.GuildVoiceStates);
}

if (env.AUTO_REGISTER_CHANNEL_ID || env.NAME_CLASS_CHANGE_CHANNEL_ID) {
  intents.push(GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent);
}

export const discordClient = new Client({
  intents,
});
