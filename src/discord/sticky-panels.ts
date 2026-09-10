import { BaseMessageOptions, Client, Events, TextChannel } from "discord.js";

// Keeps a button panel as the newest message in its channel: whenever anyone else posts, the
// old panel is deleted and a fresh copy is sent to the bottom. Tracks the current message id
// per channel in memory only — a bot restart forgets it, leaving one orphaned copy behind until
// the next chat message triggers a repost (cleaned up at startup instead, see initStickyPanels).
export interface StickyPanelConfig {
  channelId: string;
  build: () => BaseMessageOptions | Promise<BaseMessageOptions>;
}

const lastMessageId = new Map<string, string>();
const registeredConfigs = new Map<string, StickyPanelConfig>();

async function repost(channel: TextChannel, config: StickyPanelConfig): Promise<void> {
  const content = await config.build();
  const newMessage = await channel.send(content);
  const oldId = lastMessageId.get(config.channelId);
  lastMessageId.set(config.channelId, newMessage.id);

  if (oldId && oldId !== newMessage.id) {
    try {
      const oldMessage = await channel.messages.fetch(oldId);
      await oldMessage.delete();
    } catch {
      // Already deleted or too old to fetch — nothing to clean up.
    }
  }
}

export function registerStickyPanels(client: Client, configs: StickyPanelConfig[]): void {
  for (const config of configs) registeredConfigs.set(config.channelId, config);

  client.on(Events.MessageCreate, async (message) => {
    if (message.author.bot) return;
    const config = registeredConfigs.get(message.channelId);
    if (!config) return;
    try {
      await repost(message.channel as TextChannel, config);
    } catch (error) {
      console.error(`ERROR Failed to repost sticky panel in channel ${config.channelId}`, error);
    }
  });
}

// Posts a one-off message (an announcement, not a panel) into a channel, then — if that channel
// has a sticky panel — reposts the panel immediately after, so the announcement doesn't leave
// the button stranded above the "newest" message. Bot messages don't trigger the MessageCreate
// listener above (it skips bot authors), so without this the panel would silently go stale.
export async function postAnnouncement(client: Client, channelId: string, content: string): Promise<void> {
  const channel = await client.channels.fetch(channelId);
  if (!channel || !(channel instanceof TextChannel)) return;
  await channel.send(content);

  const config = registeredConfigs.get(channelId);
  if (config) await repost(channel, config);
}

// Same as postAnnouncement, but for content that may need splitting across multiple messages
// (Discord's 2000-char limit) — e.g. a long member-name list. Only bumps the sticky panel once,
// after the last chunk, rather than once per chunk.
export async function postAnnouncements(client: Client, channelId: string, contents: string[]): Promise<void> {
  const channel = await client.channels.fetch(channelId);
  if (!channel || !(channel instanceof TextChannel)) return;
  for (const content of contents) await channel.send(content);

  const config = registeredConfigs.get(channelId);
  if (config) await repost(channel, config);
}

// Splits a long message on line breaks so each chunk stays under Discord's 2000-char limit,
// keeping whole lines together rather than cutting mid-word.
export function chunkMessage(text: string, maxLength = 1900): string[] {
  const lines = text.split("\n");
  const chunks: string[] = [];
  let current = "";
  for (const line of lines) {
    if (current && current.length + line.length + 1 > maxLength) {
      chunks.push(current);
      current = line;
    } else {
      current = current ? `${current}\n${line}` : line;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

// Call once after the client is ready: clears out old panel copies (from manual scripts or a
// previous run) and posts one fresh tracked copy per configured channel.
export async function initStickyPanels(client: Client, configs: StickyPanelConfig[]): Promise<void> {
  for (const config of configs) {
    try {
      const channel = await client.channels.fetch(config.channelId);
      if (!channel || !(channel instanceof TextChannel)) continue;

      const recent = await channel.messages.fetch({ limit: 50 });
      const ownPanels = recent.filter((m) => m.author.id === client.user!.id && m.components.length > 0);
      for (const msg of ownPanels.values()) {
        await msg.delete().catch(() => {});
      }

      await repost(channel, config);
    } catch (error) {
      console.error(`ERROR Failed to initialize sticky panel in channel ${config.channelId}`, error);
    }
  }
}
