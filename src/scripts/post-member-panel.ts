import { Client, GatewayIntentBits, TextChannel } from "discord.js";
import { env } from "../config/env.js";
import { buildMemberPanelMessage } from "../discord/member-panel.js";

// One-off: posts the persistent Register / Change Name-Class / Queue button panel into a
// channel. Run again to post a fresh copy (does not edit/delete a previous one — remove old
// panel messages by hand if you don't want duplicates).
//
// Usage: npm run post-member-panel -- <channelId>

const channelId = process.argv[2];
if (!channelId) {
  console.error("Usage: npm run post-member-panel -- <channelId>");
  process.exit(1);
}

const client = new Client({ intents: [GatewayIntentBits.Guilds] });
await client.login(env.DISCORD_TOKEN);
await new Promise<void>((resolve) => client.once("ready", () => resolve()));

const channel = await client.channels.fetch(channelId);
if (!channel || !(channel instanceof TextChannel)) {
  console.error(`Channel ${channelId} not found or not a text channel.`);
  client.destroy();
  process.exit(1);
}

const message = await channel.send(buildMemberPanelMessage());
console.log(`Posted member panel to #${channel.name} (${channel.id}): ${message.url}`);

client.destroy();
