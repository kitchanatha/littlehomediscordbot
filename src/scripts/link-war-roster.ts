import { env } from "../config/env.js";
import { sheetsClient } from "../google/sheets-client.js";
import { normalizeName } from "../utils/normalize.js";

// One-off linking pass: reads the guild's manually-maintained war roster (team/party
// assignments + occasional class-symbol prefixes the bot already writes for registered
// members) and merges Team/Party/Class into Game_Roster_CombatPower, keyed by character
// name. Never touches Members — team/party there is the bot's permanent /assign structure,
// while this sheet looks like a per-war lineup snapshot, so the two aren't assumed to be
// the same thing without confirming that first.
//
// Usage: npm run link-war-roster

const spreadsheetId = env.GOOGLE_SHEET_ID;
const WAR_ROSTER_SHEET = "รายชื่อตี้วอร์ห้องหลัก";
const RAW_SHEET = "Game_Roster_CombatPower";
const HEADERS = ["CharacterName", "CombatPower", "LinkedMemberID", "LastUpdated", "Team", "Party", "Class"];

// The bot already prefixes registered members' names with their class symbol on this sheet
// (see SheetDisplayService) — reverse that mapping here to recover class from the prefix.
const classRows = (
  await sheetsClient.spreadsheets.values.get({ spreadsheetId, range: "Classes!A2:F" })
).data.values ?? [];
const symbolToClass = new Map<string, string>();
for (const row of classRows) {
  const className = row[1];
  const symbol = row[4];
  if (className && symbol) symbolToClass.set(symbol, className);
}

function stripSymbol(cell: string): { name: string; className: string | null } {
  const trimmed = cell.trim();
  for (const [symbol, className] of symbolToClass) {
    if (trimmed.startsWith(symbol)) {
      return { name: trimmed.slice(symbol.length).trim(), className };
    }
  }
  return { name: trimmed, className: null };
}

interface RosterEntry {
  characterName: string;
  team: string;
  party: number;
  className: string | null;
}

const warRosterRows = (
  await sheetsClient.spreadsheets.values.get({ spreadsheetId, range: `${WAR_ROSTER_SHEET}!A1:J100` })
).data.values ?? [];

const entries: RosterEntry[] = [];
let currentTeam: string | null = null;
let inPartyGrid = false;

for (const row of warRosterRows) {
  const firstCell = (row[0] ?? "").trim();

  const teamMatch = /^Team\s+([A-Za-z])/.exec(firstCell);
  if (teamMatch) {
    currentTeam = teamMatch[1].toUpperCase();
    inPartyGrid = false;
    continue;
  }

  // The party-number header row, e.g. ["1","2","3","4","5","6","7","8"]
  if (row.length > 0 && row.every((c) => /^\d+$/.test((c ?? "").trim()))) {
    inPartyGrid = true;
    continue;
  }

  if (row.length === 0) {
    inPartyGrid = false;
    continue;
  }

  if (inPartyGrid && currentTeam) {
    row.forEach((cell, columnIndex) => {
      const value = (cell ?? "").trim();
      if (!value) return;
      const { name, className } = stripSymbol(value);
      if (!name) return;
      entries.push({ characterName: name, team: currentTeam!, party: columnIndex + 1, className });
    });
  }
}

console.log(`Parsed ${entries.length} explicit Team A/B/C assignments from ${WAR_ROSTER_SHEET}`);

const nameToRoster = new Map<string, RosterEntry>();
for (const e of entries) nameToRoster.set(normalizeName(e.characterName), e);

// Fallback for cosmetic differences between how the same person's name is typed in this
// sheet vs. the combat-power roster (extra symbols, decorative characters, dashes, etc.),
// e.g. "-Kiwzメ" here vs "Kiwz" there — compare only letters/digits, ignoring everything else.
function coreName(s: string): string {
  return normalizeName(s).replace(/[^a-z0-9ก-๙]/g, "");
}

const coreToRoster = new Map<string, RosterEntry | "ambiguous">();
for (const e of entries) {
  const core = coreName(e.characterName);
  if (!core) continue;
  coreToRoster.set(core, coreToRoster.has(core) ? "ambiguous" : e);
}

// Levenshtein edit distance, for a last-resort "best guess" pass over whatever's left after
// exact and symbol-stripped matching — genuine typos/transliteration differences rather than
// decorative-character noise (e.g. "กุ้งเต้น" vs "ทุงเต้น").
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

function bestGuess(characterName: string, usedRosterEntries: Set<RosterEntry>): RosterEntry | null {
  const core = coreName(characterName);
  if (core.length < 3) return null;
  let best: RosterEntry | null = null;
  let bestDistance = Infinity;
  for (const e of entries) {
    if (usedRosterEntries.has(e)) continue;
    const otherCore = coreName(e.characterName);
    if (otherCore.length < 3) continue;
    const distance = editDistance(core, otherCore);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = e;
    }
  }
  // Within ~40% of the longer name's length counts as "probably the same person, typo'd".
  const threshold = Math.max(2, Math.ceil(Math.max(core.length, coreName(best?.characterName ?? "").length) * 0.4));
  return best && bestDistance <= threshold ? best : null;
}

if (!(await sheetExists(RAW_SHEET))) {
  console.error(`"${RAW_SHEET}" doesn't exist yet — run update-combat-power first.`);
  process.exit(1);
}

async function sheetExists(title: string): Promise<boolean> {
  const meta = await sheetsClient.spreadsheets.get({ spreadsheetId });
  return meta.data.sheets?.some((s) => s.properties?.title === title) ?? false;
}

// Ensure the header row has the Team/Party/Class columns (extends an older header in place).
await sheetsClient.spreadsheets.values.update({
  spreadsheetId,
  range: `${RAW_SHEET}!A1:G1`,
  valueInputOption: "RAW",
  requestBody: { values: [HEADERS] },
});

const rawRows = (
  await sheetsClient.spreadsheets.values.get({ spreadsheetId, range: `${RAW_SHEET}!A2:A` })
).data.values ?? [];

const writes: { range: string; values: string[][] }[] = [];
let linked = 0;
let fuzzyLinked = 0;
let guessed = 0;
let inferredD = 0;
const usedRosterEntries = new Set<RosterEntry>();

// Pass 1: exact and symbol-stripped matches (unambiguous — these consume their roster entry
// so pass 2's guessing can't double-assign the same person to someone else).
const pending: { characterName: string; rowNumber: number }[] = [];

rawRows.forEach((row, i) => {
  const characterName = row[0];
  if (!characterName) return;
  const rowNumber = i + 2;

  let roster = nameToRoster.get(normalizeName(characterName));
  let matchedVia: "exact" | "fuzzy" | null = roster ? "exact" : null;

  if (!roster) {
    const core = coreName(characterName);
    const fuzzyMatch = core ? coreToRoster.get(core) : undefined;
    if (fuzzyMatch && fuzzyMatch !== "ambiguous") {
      roster = fuzzyMatch;
      matchedVia = "fuzzy";
    }
  }

  if (roster) {
    usedRosterEntries.add(roster);
    writes.push({
      range: `${RAW_SHEET}!E${rowNumber}:G${rowNumber}`,
      values: [[roster.team, String(roster.party), roster.className ?? ""]],
    });
    if (matchedVia === "fuzzy") {
      console.log(`FUZZY MATCH: "${characterName}" ~ "${roster.characterName}" -> Team ${roster.team}, Party ${roster.party}`);
      fuzzyLinked++;
    } else {
      linked++;
    }
  } else {
    pending.push({ characterName, rowNumber });
  }
});

// Pass 2: best-effort guess for whatever's left, using only roster entries pass 1 didn't
// already claim.
for (const { characterName, rowNumber } of pending) {
  const guess = bestGuess(characterName, usedRosterEntries);
  if (guess) {
    usedRosterEntries.add(guess);
    writes.push({
      range: `${RAW_SHEET}!E${rowNumber}:G${rowNumber}`,
      values: [[guess.team, String(guess.party), guess.className ?? ""]],
    });
    console.log(`GUESS: "${characterName}" ~ "${guess.characterName}" -> Team ${guess.team}, Party ${guess.party}`);
    guessed++;
  } else {
    // Per the guild's own note on this sheet: anyone not explicitly listed in A/B/C is in
    // the secondary war room (Team D) — no specific party is assigned there.
    writes.push({ range: `${RAW_SHEET}!E${rowNumber}:G${rowNumber}`, values: [["D", "", ""]] });
    inferredD++;
  }
}

if (writes.length > 0) {
  await sheetsClient.spreadsheets.values.batchUpdate({
    spreadsheetId,
    requestBody: { valueInputOption: "RAW", data: writes },
  });
}

console.log(`\nDone. Linked (exact): ${linked}. Linked (fuzzy): ${fuzzyLinked}. Linked (guess): ${guessed}. Inferred Team D (unlisted): ${inferredD}.`);
