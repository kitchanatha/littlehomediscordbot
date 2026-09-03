import { env } from "../config/env.js";
import { sheetsClient } from "../google/sheets-client.js";
import { normalizeName } from "../utils/normalize.js";

// One-off enrichment pass: pushes the now-consolidated Game_Roster_CombatPower data (Combat
// Power) out to the player-facing sheets where it's useful:
//   - Each of the 10 class tabs: a new "Combat Power" column appended after the existing
//     attendance columns (never inserted before them — the attendance bot logic hardcodes
//     column positions, so existing columns must never shift).
//   - เช็คขาด-ลา: same, appended after the last existing date column.
//   - รายชื่อตี้วอร์ห้องหลัก: Combat Power appended as "(value)" text onto each matched
//     name cell in the team/party grid, matching the existing convention on that sheet
//     (the bot already prefixes registered members' names with a class-symbol emoji there).
//
// Usage: npm run push-combat-power-to-tabs

const spreadsheetId = env.GOOGLE_SHEET_ID;
const RAW_SHEET = "Game_Roster_CombatPower";
const CLASS_TABS = [
  "Knight", "Paladin", "Hunter", "Assassin", "Wizard",
  "Priest", "Monk", "Blacksmith", "Gunslinger", "Druid",
];
const ATTENDANCE_SHEET = "เช็คขาด-ลา";
const ATTENDANCE_NAME_COL = 1; // column B
const WAR_ROSTER_SHEET = "รายชื่อตี้วอร์ห้องหลัก";
const COMBAT_POWER_HEADER = "Combat Power";

function colLetter(index0: number): string {
  let n = index0 + 1;
  let s = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    s = String.fromCharCode(65 + rem) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

function coreName(s: string): string {
  return normalizeName(s).replace(/[^a-z0-9ก-๙]/g, "");
}

// Load Game_Roster_CombatPower once as the source of truth.
const rawRows = (
  await sheetsClient.spreadsheets.values.get({ spreadsheetId, range: `${RAW_SHEET}!A2:B` })
).data.values ?? [];
const nameToCP = new Map<string, string>();
const coreToCP = new Map<string, string | "ambiguous">();
for (const [name, cp] of rawRows) {
  if (!name || !cp) continue;
  nameToCP.set(normalizeName(name), cp);
  const core = coreName(name);
  if (core) coreToCP.set(core, coreToCP.has(core) ? "ambiguous" : cp);
}

function lookupCP(cellName: string): string | null {
  const exact = nameToCP.get(normalizeName(cellName));
  if (exact) return exact;
  const core = coreName(cellName);
  const fuzzy = core ? coreToCP.get(core) : undefined;
  return fuzzy && fuzzy !== "ambiguous" ? fuzzy : null;
}

async function appendColumnToNameList(sheetName: string, nameColIndex0: number): Promise<void> {
  const headerRow = (await sheetsClient.spreadsheets.values.get({ spreadsheetId, range: `${sheetName}!1:1` })).data.values?.[0] ?? [];
  if (headerRow.includes(COMBAT_POWER_HEADER)) {
    console.log(`SKIP ${sheetName}: "${COMBAT_POWER_HEADER}" column already exists`);
    return;
  }
  const newColIndex0 = headerRow.length;
  const newColLetter = colLetter(newColIndex0);

  const nameColLetter = colLetter(nameColIndex0);
  const names = (
    await sheetsClient.spreadsheets.values.get({ spreadsheetId, range: `${sheetName}!${nameColLetter}2:${nameColLetter}` })
  ).data.values ?? [];

  const values: string[][] = [[COMBAT_POWER_HEADER]];
  let matched = 0;
  for (const [name] of names) {
    const cp = name ? lookupCP(name) : null;
    values.push([cp ?? ""]);
    if (cp) matched++;
  }

  await sheetsClient.spreadsheets.values.update({
    spreadsheetId,
    range: `${sheetName}!${newColLetter}1:${newColLetter}${values.length}`,
    valueInputOption: "RAW",
    requestBody: { values },
  });
  console.log(`${sheetName}: added Combat Power at column ${newColLetter}, matched ${matched}/${names.length}`);
}

for (const tab of CLASS_TABS) {
  await appendColumnToNameList(tab, 0);
}
await appendColumnToNameList(ATTENDANCE_SHEET, ATTENDANCE_NAME_COL);

// War roster: append "(CP)" to each matched name cell in the team/party grid, skipping cells
// that already carry a class-symbol prefix from the bot's own sync (leave that untouched,
// append after it) and skipping cells that already have a "(...)" suffix (idempotent re-run).
const warRosterRows = (
  await sheetsClient.spreadsheets.values.get({ spreadsheetId, range: `${WAR_ROSTER_SHEET}!A1:J100` })
).data.values ?? [];

let inPartyGrid = false;
const warRosterWrites: { range: string; values: string[][] }[] = [];
let warRosterMatched = 0;

warRosterRows.forEach((row, rowIndex0) => {
  const firstCell = (row[0] ?? "").trim();
  if (/^Team\s+[A-Za-z]/.test(firstCell)) {
    inPartyGrid = false;
    return;
  }
  if (row.length > 0 && row.every((c) => /^\d+$/.test((c ?? "").trim()))) {
    inPartyGrid = true;
    return;
  }
  if (row.length === 0) {
    inPartyGrid = false;
    return;
  }
  if (!inPartyGrid) return;

  row.forEach((cell, colIndex0) => {
    const value = (cell ?? "").trim();
    if (!value || /\(\d+\)\s*$/.test(value)) return; // already has a CP suffix
    const cp = lookupCP(value);
    if (!cp) return;
    const rowNumber = rowIndex0 + 1;
    warRosterWrites.push({
      range: `${WAR_ROSTER_SHEET}!${colLetter(colIndex0)}${rowNumber}`,
      values: [[`${value} (${cp})`]],
    });
    warRosterMatched++;
  });
});

if (warRosterWrites.length > 0) {
  await sheetsClient.spreadsheets.values.batchUpdate({
    spreadsheetId,
    requestBody: { valueInputOption: "RAW", data: warRosterWrites },
  });
}
console.log(`${WAR_ROSTER_SHEET}: appended Combat Power to ${warRosterMatched} name cells`);
