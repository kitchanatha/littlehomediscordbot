import { Client, GatewayIntentBits } from "discord.js";
import { env } from "../config/env.js";
import { GoogleSheetsMemberRepository } from "../repositories/google-sheets-member-repository.js";
import { GoogleSheetsQueueRepository } from "../repositories/google-sheets-queue-repository.js";
import { GoogleSheetsDisplayRepository } from "../repositories/display-repository.js";
import { MemberService, UserError } from "../services/member-service.js";
import { ClassService } from "../services/class-service.js";
import { QueueService } from "../services/queue-service.js";
import { SheetDisplayService } from "../services/sheet-display-service.js";
import { parseCharacterForm, resolveClassName } from "../utils/character-form-parser.js";

// One-time backfill: registers members from the registration-form messages already sitting
// in AUTO_REGISTER_CHANNEL_ID, for people who posted before the live auto-register listener
// existed. Unlike the live listener, this prints a full report — it's an admin running a
// one-off tool, not a background process that should stay quiet in the channel.
if (!env.AUTO_REGISTER_CHANNEL_ID) {
  console.error("AUTO_REGISTER_CHANNEL_ID is not set — nothing to backfill.");
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

const channel = await client.channels.fetch(env.AUTO_REGISTER_CHANNEL_ID);
if (!channel || !channel.isTextBased()) {
  console.error(`Channel ${env.AUTO_REGISTER_CHANNEL_ID} was not found or is not a text channel.`);
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
messages.reverse(); // oldest first, so the earliest post for a given person wins

console.log(`Fetched ${messages.length} messages. Processing...\n`);

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

let registered = 0;
let skipped = 0;
let errors = 0;
const activeClasses = await classService.getActiveClasses();

for (const message of messages) {
  if (message.author.bot) continue;

  const { characterName, rawClass } = parseCharacterForm(message.content);
  if (!characterName || !rawClass) continue; // not a registration-form message

  const who = `${message.author.tag} (${message.author.id})`;

  // A single registration is several Sheets API reads/writes; pace them so a run of 100+
  // members doesn't blow through the "read requests per minute" quota (we hit this in
  // practice — most calls succeeded on gaxios's built-in retry, but ~30 exhausted retries
  // and failed outright).
  await sleep(3000);

  try {
    const className = resolveClassName(rawClass, activeClasses);
    if (!className) {
      console.log(`SKIP ${who}: could not resolve class "${rawClass}"`);
      skipped++;
      continue;
    }

    const result = await service.register({
      discordId: message.author.id,
      discordUsername: message.author.username,
      characterName,
      className,
    });
    console.log(`REGISTERED ${who} as ${result.member.characterName} (${result.member.className})`);
    registered++;
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

console.log(`\nDone. Registered: ${registered}, Skipped: ${skipped}, Errors: ${errors}`);
await client.destroy();
process.exit(0);
