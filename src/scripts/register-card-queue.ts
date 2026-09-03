import { GoogleSheetsMemberRepository } from "../repositories/google-sheets-member-repository.js";
import { GoogleSheetsQueueRepository } from "../repositories/google-sheets-queue-repository.js";
import { ClassService } from "../services/class-service.js";
import { QueueService } from "../services/queue-service.js";
import { normalizeName } from "../utils/normalize.js";

// One-off bulk enqueue: registers a guild-provided name list into the Card queue, in the
// order given, going through the real QueueService (so cooldown checks, duplicate checks,
// position assignment, history, and the คิวการ์ดประดับ display all happen exactly as they
// would for a normal /queue_join). Names are matched against registered Discord members by
// character name; anyone not found (not registered) is skipped and reported at the end.
//
// Usage: npm run register-card-queue

const NAMES = [
  "NOVA_", "ไอดีพัง", "Soyyanhe", "บาเบล", "เสาหลักแสงโสม", "Newz", "MARGARITA",
  "อย่าเสล่อ", "Amojoeee", "เสาหลักหงส์ทอง", "F!NN", "Iwชsssss", "Zephyrus", "Kiwz",
  "TeDz", "Jasna", "เสาหลักรีเจนส์", "貓女神の愛", "สาหร่าย", "LOKI", "ระดับเซียน",
  "Diagond", "ผมรักครอบครัว", "Aemz", "cYnn", "Judaz", "Parpiko", "PuRin", "MuMonggy",
  "มะหมวยหอกปลิว", "Xeesoxeee",
];

function coreName(s: string): string {
  return normalizeName(s).replace(/[^a-z0-9ก-๙]/g, "");
}

const repository = new GoogleSheetsMemberRepository();
const classService = new ClassService(repository);
const queueRepository = new GoogleSheetsQueueRepository();
const queueService = new QueueService(queueRepository, repository, classService);

const members = await repository.getAllActiveMembers();
const byExact = new Map<string, typeof members[number]>();
const byCore = new Map<string, typeof members[number] | "ambiguous">();
for (const m of members) {
  byExact.set(normalizeName(m.characterName), m);
  const core = coreName(m.characterName);
  if (core) byCore.set(core, byCore.has(core) ? "ambiguous" : m);
}

function lookupMember(name: string) {
  const exact = byExact.get(normalizeName(name));
  if (exact) return exact;
  const core = coreName(name);
  const fuzzy = core ? byCore.get(core) : undefined;
  if (fuzzy && fuzzy !== "ambiguous") return fuzzy;

  // Last resort: the queried name is a truncated prefix of exactly one registered member's
  // name (e.g. "F!NN" -> "F!NNX") — only accept if unambiguous.
  if (core.length >= 3) {
    const candidates = [...byCore.entries()].filter(([c]) => c.startsWith(core) && c !== core);
    if (candidates.length === 1 && candidates[0][1] !== "ambiguous") return candidates[0][1];
  }
  return null;
}

const notFound: string[] = [];
const enqueued: string[] = [];
const failed: { name: string; reason: string }[] = [];

for (const name of NAMES) {
  const member = lookupMember(name);
  if (!member) {
    notFound.push(name);
    continue;
  }
  try {
    const entry = await queueService.enqueue({
      targetDiscordId: member.discordId,
      queueType: "Card",
      changedByDiscordId: "ADMIN_BULK_IMPORT",
    });
    enqueued.push(`${member.characterName} (#${entry.position})`);
    console.log(`OK ${member.characterName} -> #${entry.position}`);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    failed.push({ name: member.characterName, reason });
    console.log(`FAIL ${member.characterName}: ${reason}`);
  }
}

console.log(`\nEnqueued ${enqueued.length}/${NAMES.length}:`);
for (const e of enqueued) console.log(`  ${e}`);

if (failed.length > 0) {
  console.log(`\nFailed (${failed.length}):`);
  for (const f of failed) console.log(`  ${f.name}: ${f.reason}`);
}

if (notFound.length > 0) {
  console.log(`\nNot found / not registered (${notFound.length}):`);
  for (const n of notFound) console.log(`  ${n}`);
}
