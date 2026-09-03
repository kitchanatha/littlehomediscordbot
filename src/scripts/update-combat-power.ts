import { readFileSync } from "node:fs";
import { env } from "../config/env.js";
import { sheetsClient } from "../google/sheets-client.js";
import { normalizeName } from "../utils/normalize.js";

// One-off data-entry tool: the guild's combat power ("Gear Rating" in-game) isn't exposed
// anywhere the bot can read automatically, so it's transcribed by hand from screenshots of
// the in-game guild member list and applied here.
//
// Every entry is recorded in Game_Roster_CombatPower (created if missing) regardless of
// Discord-match status — that sheet is the durable record of what's actually in the game,
// independent of who has registered with the bot yet. Entries that DO match an existing
// registered member (by character name) are also mirrored to column K (CombatPower) on the
// Members sheet. Re-running with corrected data or after more members register updates
// existing rows in place rather than duplicating them.
//
// Usage: npm run update-combat-power -- path/to/entries.json
// entries.json: [{ "characterName": "STT-03", "combatPower": "39700" }, ...]

const inputPath = process.argv[2];
if (!inputPath) {
  console.error("Usage: npm run update-combat-power -- path/to/entries.json");
  process.exit(1);
}

interface Entry {
  characterName: string;
  combatPower: string | number;
}

const entries: Entry[] = JSON.parse(readFileSync(inputPath, "utf-8"));

const spreadsheetId = env.GOOGLE_SHEET_ID;
const MEMBERS_COMBAT_POWER_COL = "K";
const MEMBERS_COMBAT_POWER_COL_INDEX0 = 10; // K is the 11th column, 0-indexed 10
const MEMBERS_HEADER = "CombatPower";
const RAW_SHEET = "Game_Roster_CombatPower";
const RAW_HEADERS = ["CharacterName", "CombatPower", "LinkedMemberID", "LastUpdated"];

const sheetMeta = await sheetsClient.spreadsheets.get({ spreadsheetId });
const membersSheet = sheetMeta.data.sheets?.find((s) => s.properties?.title === "Members");
const membersSheetId = membersSheet?.properties?.sheetId;
const currentColumnCount = membersSheet?.properties?.gridProperties?.columnCount ?? 0;

if (membersSheetId === undefined) {
  console.error('Could not find the "Members" sheet.');
  process.exit(1);
}

// A GridRange/A1 write past the sheet's current column count fails with "exceeds grid
// limits" instead of auto-expanding, so grow the grid first if column K doesn't exist yet.
if (currentColumnCount <= MEMBERS_COMBAT_POWER_COL_INDEX0) {
  await sheetsClient.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [{
        appendDimension: {
          sheetId: membersSheetId,
          dimension: "COLUMNS",
          length: MEMBERS_COMBAT_POWER_COL_INDEX0 + 1 - currentColumnCount,
        },
      }],
    },
  });
  console.log(`Grew Members sheet to ${MEMBERS_COMBAT_POWER_COL_INDEX0 + 1} columns`);
}

const membersHeaderCell = (
  await sheetsClient.spreadsheets.values.get({
    spreadsheetId,
    range: `Members!${MEMBERS_COMBAT_POWER_COL}1`,
  })
).data.values?.[0]?.[0];

if (!membersHeaderCell) {
  await sheetsClient.spreadsheets.values.update({
    spreadsheetId,
    range: `Members!${MEMBERS_COMBAT_POWER_COL}1`,
    valueInputOption: "RAW",
    requestBody: { values: [[MEMBERS_HEADER]] },
  });
  console.log(`Added "${MEMBERS_HEADER}" header at Members!${MEMBERS_COMBAT_POWER_COL}1`);
}

if (!sheetMeta.data.sheets?.some((s) => s.properties?.title === RAW_SHEET)) {
  await sheetsClient.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: { requests: [{ addSheet: { properties: { title: RAW_SHEET } } }] },
  });
  await sheetsClient.spreadsheets.values.update({
    spreadsheetId,
    range: `${RAW_SHEET}!A1`,
    valueInputOption: "RAW",
    requestBody: { values: [RAW_HEADERS] },
  });
  console.log(`Created "${RAW_SHEET}" sheet`);
}

const memberRows = (
  await sheetsClient.spreadsheets.values.get({
    spreadsheetId,
    range: "Members!A2:D",
  })
).data.values ?? [];

// character name -> { rowNumber on Members, memberId } for matching
const nameToMember = new Map<string, { rowNumber: number; memberId: string }>();
memberRows.forEach((row, i) => {
  const characterName = row[3];
  if (characterName) nameToMember.set(normalizeName(characterName), { rowNumber: i + 2, memberId: row[0] ?? "" });
});

const rawRows = (
  await sheetsClient.spreadsheets.values.get({ spreadsheetId, range: `${RAW_SHEET}!A2:A` })
).data.values ?? [];
const rawNameToRow = new Map<string, number>();
rawRows.forEach((row, i) => {
  if (row[0]) rawNameToRow.set(normalizeName(row[0]), i + 2);
});

let matched = 0;
let unmatched = 0;
const membersWrites: { range: string; values: string[][] }[] = [];
const rawWrites: { range: string; values: string[][] }[] = [];
const rawAppends: string[][] = [];
const now = new Date().toISOString();

for (const entry of entries) {
  const member = nameToMember.get(normalizeName(entry.characterName));
  if (member) {
    membersWrites.push({
      range: `Members!${MEMBERS_COMBAT_POWER_COL}${member.rowNumber}`,
      values: [[String(entry.combatPower)]],
    });
    matched++;
  } else {
    unmatched++;
  }

  const rawRow = [entry.characterName, String(entry.combatPower), member?.memberId ?? "", now];
  const existingRawRow = rawNameToRow.get(normalizeName(entry.characterName));
  if (existingRawRow) {
    rawWrites.push({ range: `${RAW_SHEET}!A${existingRawRow}:D${existingRawRow}`, values: [rawRow] });
  } else {
    rawAppends.push(rawRow);
  }

  console.log(
    member
      ? `MATCHED: ${entry.characterName} -> ${entry.combatPower} (Members row ${member.rowNumber})`
      : `NOT YET REGISTERED: ${entry.characterName} -> ${entry.combatPower} (recorded in ${RAW_SHEET} only)`
  );
}

if (membersWrites.length > 0) {
  await sheetsClient.spreadsheets.values.batchUpdate({
    spreadsheetId,
    requestBody: { valueInputOption: "RAW", data: membersWrites },
  });
}

if (rawWrites.length > 0) {
  await sheetsClient.spreadsheets.values.batchUpdate({
    spreadsheetId,
    requestBody: { valueInputOption: "RAW", data: rawWrites },
  });
}

if (rawAppends.length > 0) {
  await sheetsClient.spreadsheets.values.append({
    spreadsheetId,
    range: `${RAW_SHEET}!A:D`,
    valueInputOption: "RAW",
    insertDataOption: "INSERT_ROWS",
    requestBody: { values: rawAppends },
  });
}

console.log(
  `\nDone. Recorded ${entries.length} entries in ${RAW_SHEET} (${rawWrites.length} updated, ${rawAppends.length} new).`
);
console.log(`Matched to a registered Discord member: ${matched}. Not yet registered: ${unmatched}.`);
