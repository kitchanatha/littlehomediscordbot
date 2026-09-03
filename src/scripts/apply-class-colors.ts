import { sheets_v4 } from "googleapis";
import { env } from "../config/env.js";
import { sheetsClient } from "../google/sheets-client.js";
import { hexToRgb } from "../utils/color.js";
import { normalizeName } from "../utils/normalize.js";

// Applies each class's color (from the Classes sheet, the same colors the bot already uses
// for registered members via SheetDisplayService) as a cell background across every tab that
// shows character names — including the 107 members who aren't Discord-registered yet, now
// that Game_Roster_CombatPower has their class from the guild's own class tabs. Only touches
// background color, never cell text/structure.
//
// Usage: npm run apply-class-colors

const spreadsheetId = env.GOOGLE_SHEET_ID;
const RAW_SHEET = "Game_Roster_CombatPower";
const CLASS_TABS = [
  "Knight", "Paladin", "Hunter", "Assassin", "Wizard",
  "Priest", "Monk", "Blacksmith", "Gunslinger", "Druid",
];
const ATTENDANCE_SHEET = "เช็คขาด-ลา";
const ATTENDANCE_NAME_COL0 = 1; // column B
const WAR_ROSTER_SHEET = "รายชื่อตี้วอร์ห้องหลัก";

function coreName(s: string): string {
  return normalizeName(s).replace(/[^a-z0-9ก-๙]/g, "");
}

// className -> RGB color
const classRows = (
  await sheetsClient.spreadsheets.values.get({ spreadsheetId, range: "Classes!A2:F" })
).data.values ?? [];
const classToColor = new Map<string, sheets_v4.Schema$Color>();
for (const row of classRows) {
  const className = row[1];
  const colorHex = row[5];
  const rgb = colorHex ? hexToRgb(colorHex) : null;
  if (className && rgb) classToColor.set(className, rgb);
}

// characterName -> className, from the consolidated roster (covers registered + unregistered)
const rawRows = (
  await sheetsClient.spreadsheets.values.get({ spreadsheetId, range: `${RAW_SHEET}!A2:G` })
).data.values ?? [];
const nameToClass = new Map<string, string>();
const coreToClass = new Map<string, string | "ambiguous">();
for (const row of rawRows) {
  const [name, , , , , , className] = row;
  if (!name || !className) continue;
  nameToClass.set(normalizeName(name), className);
  const core = coreName(name);
  if (core) coreToClass.set(core, coreToClass.has(core) && coreToClass.get(core) !== className ? "ambiguous" : className);
}

function lookupClass(cellName: string): string | null {
  const exact = nameToClass.get(normalizeName(cellName));
  if (exact) return exact;
  const core = coreName(cellName);
  const fuzzy = core ? coreToClass.get(core) : undefined;
  return fuzzy && fuzzy !== "ambiguous" ? fuzzy : null;
}

const sheetMeta = await sheetsClient.spreadsheets.get({ spreadsheetId });
function sheetIdOf(title: string): number | undefined {
  return sheetMeta.data.sheets?.find((s) => s.properties?.title === title)?.properties?.sheetId ?? undefined;
}

function colorRequest(sheetId: number, row0: number, col0: number, color: sheets_v4.Schema$Color): sheets_v4.Schema$Request {
  return {
    updateCells: {
      range: { sheetId, startRowIndex: row0, endRowIndex: row0 + 1, startColumnIndex: col0, endColumnIndex: col0 + 1 },
      rows: [{ values: [{ userEnteredFormat: { backgroundColor: color } }] }],
      fields: "userEnteredFormat.backgroundColor",
    },
  };
}

const requests: sheets_v4.Schema$Request[] = [];
let totalColored = 0;

// 1. Game_Roster_CombatPower itself — color column A by its own Class column (G).
{
  const sheetId = sheetIdOf(RAW_SHEET);
  if (sheetId !== undefined) {
    let colored = 0;
    rawRows.forEach((row, i) => {
      const [name, , , , , , className] = row;
      const color = className ? classToColor.get(className) : undefined;
      if (name && color) {
        requests.push(colorRequest(sheetId, i + 1, 0, color));
        colored++;
      }
    });
    console.log(`${RAW_SHEET}: queued ${colored} cells`);
    totalColored += colored;
  }
}

// 2. Each class tab — color column A (name) with that tab's own fixed class color.
for (const className of CLASS_TABS) {
  const sheetId = sheetIdOf(className);
  const color = classToColor.get(className);
  if (sheetId === undefined || !color) continue;
  const names = (await sheetsClient.spreadsheets.values.get({ spreadsheetId, range: `${className}!A2:A` })).data.values ?? [];
  let colored = 0;
  names.forEach((row, i) => {
    if (row[0]) {
      requests.push(colorRequest(sheetId, i + 1, 0, color));
      colored++;
    }
  });
  console.log(`${className}: queued ${colored} cells`);
  totalColored += colored;
}

// 3. เช็คขาด-ลา — color column B (name) by looked-up class.
{
  const sheetId = sheetIdOf(ATTENDANCE_SHEET);
  if (sheetId !== undefined) {
    const colLetter = String.fromCharCode(65 + ATTENDANCE_NAME_COL0);
    const names = (await sheetsClient.spreadsheets.values.get({ spreadsheetId, range: `${ATTENDANCE_SHEET}!${colLetter}2:${colLetter}` })).data.values ?? [];
    let colored = 0;
    names.forEach((row, i) => {
      const name = row[0];
      const className = name ? lookupClass(name) : null;
      const color = className ? classToColor.get(className) : undefined;
      if (color) {
        requests.push(colorRequest(sheetId, i + 1, ATTENDANCE_NAME_COL0, color));
        colored++;
      }
    });
    console.log(`${ATTENDANCE_SHEET}: queued ${colored} cells`);
    totalColored += colored;
  }
}

// 4. รายชื่อตี้วอร์ห้องหลัก — color every matched name cell in the team/party grid.
{
  const sheetId = sheetIdOf(WAR_ROSTER_SHEET);
  if (sheetId !== undefined) {
    const warRosterRows = (await sheetsClient.spreadsheets.values.get({ spreadsheetId, range: `${WAR_ROSTER_SHEET}!A1:J100` })).data.values ?? [];
    let inPartyGrid = false;
    let colored = 0;
    warRosterRows.forEach((row, rowIndex0) => {
      const firstCell = (row[0] ?? "").trim();
      if (/^Team\s+[A-Za-z]/.test(firstCell)) { inPartyGrid = false; return; }
      if (row.length > 0 && row.every((c) => /^\d+$/.test((c ?? "").trim()))) { inPartyGrid = true; return; }
      if (row.length === 0) { inPartyGrid = false; return; }
      if (!inPartyGrid) return;

      row.forEach((cell, colIndex0) => {
        const value = (cell ?? "").trim();
        if (!value) return;
        // Strip a trailing "(CP)" suffix and a leading class-symbol emoji, if present, before matching.
        const withoutCP = value.replace(/\s*\(\d+\)\s*$/, "");
        const className = lookupClass(withoutCP) ?? lookupClass(value);
        const color = className ? classToColor.get(className) : undefined;
        if (color) {
          requests.push(colorRequest(sheetId, rowIndex0, colIndex0, color));
          colored++;
        }
      });
    });
    console.log(`${WAR_ROSTER_SHEET}: queued ${colored} cells`);
    totalColored += colored;
  }
}

// Google Sheets batchUpdate has a practical request-count ceiling; chunk to be safe.
const CHUNK_SIZE = 400;
for (let i = 0; i < requests.length; i += CHUNK_SIZE) {
  await sheetsClient.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: { requests: requests.slice(i, i + CHUNK_SIZE) },
  });
}

console.log(`\nDone. Colored ${totalColored} cells across ${1 + CLASS_TABS.length + 2} tabs.`);
