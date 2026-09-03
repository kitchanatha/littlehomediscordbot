import { env } from "../config/env.js";
import { sheetsClient } from "../google/sheets-client.js";
import { normalizeName } from "../utils/normalize.js";

// One-off linking pass: each of the guild's 10 class tabs lists every member of that class
// under "รายชื่อทั้งหมด" (full name list) — this is real, guild-maintained ground truth for
// class, independent of Discord registration. Cross-references those lists against
// Game_Roster_CombatPower and fills in Class for anyone not already linked to a registered
// Discord member (those already have a real, known class from Members — never overwritten).
//
// Usage: npm run link-class-tabs

const spreadsheetId = env.GOOGLE_SHEET_ID;
const RAW_SHEET = "Game_Roster_CombatPower";
const CLASS_TABS = [
  "Knight", "Paladin", "Hunter", "Assassin", "Wizard",
  "Priest", "Monk", "Blacksmith", "Gunslinger", "Druid",
];

function coreName(s: string): string {
  return normalizeName(s).replace(/[^a-z0-9ก-๙]/g, "");
}

interface ClassEntry {
  characterName: string;
  className: string;
}

const entries: ClassEntry[] = [];
for (const className of CLASS_TABS) {
  const rows = (
    await sheetsClient.spreadsheets.values.get({ spreadsheetId, range: `${className}!A2:A` })
  ).data.values ?? [];
  for (const row of rows) {
    const name = (row[0] ?? "").trim();
    if (name) entries.push({ characterName: name, className });
  }
}
console.log(`Read ${entries.length} name/class entries across ${CLASS_TABS.length} class tabs`);

const nameToClass = new Map<string, ClassEntry | "ambiguous">();
for (const e of entries) {
  const key = normalizeName(e.characterName);
  const existing = nameToClass.get(key);
  if (existing && existing !== "ambiguous" && existing.className !== e.className) {
    console.log(`AMBIGUOUS: "${e.characterName}" appears in both ${existing.className} and ${e.className} tabs`);
    nameToClass.set(key, "ambiguous");
  } else if (!existing) {
    nameToClass.set(key, e);
  }
}

const coreToClass = new Map<string, ClassEntry | "ambiguous">();
for (const e of entries) {
  const core = coreName(e.characterName);
  if (!core) continue;
  const existing = coreToClass.get(core);
  if (existing && existing !== "ambiguous" && existing.className !== e.className) {
    coreToClass.set(core, "ambiguous");
  } else if (!existing) {
    coreToClass.set(core, e);
  }
}

// Levenshtein edit distance — last-resort best guess for genuine typos/transliteration
// differences between how a name is spelled in a class tab vs. the combat-power roster.
function editDistance(a: string, b: string): number {
  const dp: number[][] = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
  for (let i = 0; i <= a.length; i++) dp[i][0] = i;
  for (let j = 0; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[a.length][b.length];
}

function bestGuess(characterName: string): ClassEntry | null {
  const core = coreName(characterName);
  if (core.length < 3) return null;
  let best: ClassEntry | null = null;
  let bestDistance = Infinity;
  for (const e of entries) {
    const otherCore = coreName(e.characterName);
    if (otherCore.length < 3) continue;
    const distance = editDistance(core, otherCore);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = e;
    }
  }
  const threshold = Math.max(2, Math.ceil(Math.max(core.length, coreName(best?.characterName ?? "").length) * 0.4));
  return best && bestDistance <= threshold ? best : null;
}

const rawRes = await sheetsClient.spreadsheets.values.get({ spreadsheetId, range: `${RAW_SHEET}!A2:G` });
const rows = rawRes.data.values ?? [];

const writes: { range: string; values: string[][] }[] = [];
let exact = 0;
let fuzzy = 0;
let guessed = 0;
let skippedAlreadyKnown = 0;

rows.forEach((row, i) => {
  const [characterName, , , , , , existingClass] = row;
  if (!characterName) return;
  if (existingClass) {
    skippedAlreadyKnown++;
    return;
  }
  const rowNumber = i + 2;

  let match = nameToClass.get(normalizeName(characterName));
  let via: "exact" | "fuzzy" | "guess" = "exact";
  if (!match) {
    const core = coreName(characterName);
    match = core ? coreToClass.get(core) : undefined;
    via = "fuzzy";
  }
  if (!match) {
    const guess = bestGuess(characterName);
    if (guess) {
      match = guess;
      via = "guess";
    }
  }
  if (!match || match === "ambiguous") return;

  writes.push({ range: `${RAW_SHEET}!G${rowNumber}`, values: [[match.className]] });
  const label = via === "exact" ? "MATCH" : via === "fuzzy" ? "FUZZY" : "GUESS";
  console.log(`${label}: ${characterName} -> ${match.className}${via !== "exact" ? ` (tab: "${match.characterName}")` : ""}`);
  if (via === "exact") exact++;
  else if (via === "fuzzy") fuzzy++;
  else guessed++;
});

if (writes.length > 0) {
  await sheetsClient.spreadsheets.values.batchUpdate({
    spreadsheetId,
    requestBody: { valueInputOption: "RAW", data: writes },
  });
}

console.log(`\nDone. Linked (exact): ${exact}. Linked (fuzzy): ${fuzzy}. Linked (guess): ${guessed}. Already known (skipped): ${skippedAlreadyKnown}. Still unknown: ${rows.length - exact - fuzzy - guessed - skippedAlreadyKnown}.`);
