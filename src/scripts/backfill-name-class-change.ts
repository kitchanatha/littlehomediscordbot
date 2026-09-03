import { Client, GatewayIntentBits } from "discord.js";
import { env } from "../config/env.js";
import { GoogleSheetsMemberRepository } from "../repositories/google-sheets-member-repository.js";
import { GoogleSheetsQueueRepository } from "../repositories/google-sheets-queue-repository.js";
import { GoogleSheetsDisplayRepository } from "../repositories/display-repository.js";
import { MemberService, UserError } from "../services/member-service.js";
import { ClassService } from "../services/class-service.js";
import { QueueService } from "../services/queue-service.js";
import { SheetDisplayService } from "../services/sheet-display-service.js";
import { parseNameClassChange } from "../utils/name-class-change-parser.js";

// One-time backfill: applies name/class change requests from messages already sitting in
// NAME_CLASS_CHANGE_CHANNEL_ID, for changes posted before the live listener existed. Processed
// oldest-first so a member who changed more than once ends up on their latest change. Unlike
// the live listener, this prints a full report — an admin runs this once, it's not meant to
// stay quiet like the background listener.
if (!env.NAME_CLASS_CHANGE_CHANNEL_ID) {
  console.error("NAME_CLASS_CHANGE_CHANNEL_ID is not set — nothing to backfill.");
  process.exit(1);
}

const repository = new GoogleSheetsMemberRepository();
const classService = new ClassService(repository);
const displayRepository = new GoogleSheetsDisplayRepository();
const sheetDisplayService = new SheetDisplayService(repository, displayRepository, classService);
const queueRepository = new GoogleSheetsQueueRepository();
const queueService = new QueueService(queueRepository, repository, classService);
const service = new MemberService(repository, classService, sheetDisplayService, queueService);

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
});

await client.login(env.DISCORD_TOKEN);
await new Promise<void>((resolve) => client.once("ready", () => resolve()));

const channel = await client.channels.fetch(env.NAME_CLASS_CHANGE_CHANNEL_ID);
if (!channel || !channel.isTextBased()) {
  console.error(`Channel ${env.NAME_CLASS_CHANGE_CHANNEL_ID} was not found or is not a text channel.`);
  await client.destroy();
  process.exit(1);
}

console.log(`Fetching message history from #${"name" in channel ? channel.name : channel.id}...`);

const messages = [];
let before: string | undefined;
for (;;) {
  const batch = await channel.messages.fetch({ limit: 100, before });
  if (batch.size === 0) break;
  messages.push(...batch.values());
  before = batch.last()?.id;
  if (batch.size < 100) break;
}
messages.reverse(); // oldest first, so a member's latest change wins

console.log(`Fetched ${messages.length} messages. Processing...\n`);

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

let applied = 0;
let skipped = 0;
let errors = 0;
const activeClasses = await classService.getActiveClasses();

for (const message of messages) {
  if (message.author.bot) continue;

  const result = parseNameClassChange(message.content, activeClasses);
  const who = `${message.author.tag} (${message.author.id})`;

  if (result.ambiguousMultipleTargets) {
    console.log(`SKIP ${who}: message reports changes for multiple targets, can't tell which is the poster's own`);
    skipped++;
    continue;
  }
  if (!result.newName && !result.newClass) {
    if (result.unresolvedClass) {
      console.log(`SKIP ${who}: could not resolve class "${result.unresolvedClass}"`);
      skipped++;
    }
    continue; // not a change-request message at all — no log, keeps output readable
  }

  // updateNameAndClass does noticeably more Sheets API reads per call than a registration
  // (it also refreshes the member's display across every class tab, plus the visual queue),
  // so this needs more headroom than the 3s used for auto-register — 3s alone still leaned
  // heavily on retries in practice.
  await sleep(8000);

  try {
    const updateResult = await service.updateNameAndClass({
      targetDiscordId: message.author.id,
      newName: result.newName ?? undefined,
      newClass: result.newClass ?? undefined,
      changedByDiscordId: message.author.id,
    });
    console.log(
      `APPLIED ${who}: nameChanged=${updateResult.nameChanged} classChanged=${updateResult.classChanged} -> ${updateResult.member.characterName} (${updateResult.member.className})`
    );
    applied++;
  } catch (error) {
    if (error instanceof UserError) {
      console.log(`SKIP ${who}: ${error.message}`);
      skipped++;
    } else {
      console.error(`ERROR ${who}:`, error);
      errors++;
    }
  }
}

console.log(`\nDone. Applied: ${applied}, Skipped: ${skipped}, Errors: ${errors}`);
await client.destroy();
process.exit(0);
