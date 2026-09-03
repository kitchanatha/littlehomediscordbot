import { sheets_v4 } from "googleapis";
import { env } from "../config/env.js";
import { sheetsClient } from "../google/sheets-client.js";
import { hexToRgb } from "../utils/color.js";
import { normalizeName } from "../utils/normalize.js";

// Reorders เช็คขาด-ลา's data rows into contiguous class blocks (matching the class colors
// already applied to column B), and renumbers column A 1, 2, 3... starting over at each class
// block. Every other column (each war-date attendance mark, Combat Power) travels with its row
// — only the row order and column A's numbers change. Column A and B are then recolored by
// class so the grouping is visually obvious; unmatched names are left uncolored and placed in
// a trailing "Unknown" block, keeping their original relative order.
//
// Usage: npm run sort-attendance-by-class

const spreadsheetId = env.GOOGLE_SHEET_ID;
const RAW_SHEET = "Game_Roster_CombatPower";
const ATTENDANCE_SHEET = "เช็คขาด-ลา";
const NAME_COL0 = 1; // column B
const CLASS_ORDER = [
  "Knight", "Paladin", "Hunter", "Assassin", "Wizard",
  "Priest", "Monk", "Blacksmith", "Gunslinger", "Druid",
];

function coreName(s: string): string {
  return normalizeName(s).replace(/[^a-z0-9ก-๙]/g, "");
}

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

const grid = (
  await sheetsClient.spreadsheets.values.get({ spreadsheetId, range: `${ATTENDANCE_SHEET}!A1:Z1016` })
).data.values ?? [];

const header = grid[0];
const dataRows = grid.slice(1).filter((r) => r[NAME_COL0] && r[NAME_COL0].trim());
const width = header.length;

type Bucket = { className: string | null; rows: string[][] };
const buckets = new Map<string | null, Bucket>();
for (const className of CLASS_ORDER) buckets.set(className, { className, rows: [] });
buckets.set(null, { className: null, rows: [] });

for (const row of dataRows) {
  const className = lookupClass(row[NAME_COL0]);
  const bucket = className && buckets.has(className) ? buckets.get(className)! : buckets.get(null)!;
  bucket.rows.push(row);
}

const orderedBuckets = [...CLASS_ORDER.map((c) => buckets.get(c)!), buckets.get(null)!];

const newRows: string[][] = [];
const rowClasses: (string | null)[] = [];
for (const bucket of orderedBuckets) {
  bucket.rows.forEach((row, i) => {
    const padded = [...row];
    while (padded.length < width) padded.push("");
    padded[0] = String(i + 1);
    newRows.push(padded);
    rowClasses.push(bucket.className);
  });
  console.log(`${bucket.className ?? "Unknown"}: ${bucket.rows.length} members`);
}

await sheetsClient.spreadsheets.values.update({
  spreadsheetId,
  range: `${ATTENDANCE_SHEET}!A2:${String.fromCharCode(64 + width)}${1 + newRows.length}`,
  valueInputOption: "RAW",
  requestBody: { values: newRows },
});
console.log(`\nWrote ${newRows.length} reordered rows.`);

const sheetMeta = await sheetsClient.spreadsheets.get({ spreadsheetId });
const sheetId = sheetMeta.data.sheets?.find((s) => s.properties?.title === ATTENDANCE_SHEET)?.properties?.sheetId;

if (sheetId !== undefined) {
  const requests: sheets_v4.Schema$Request[] = [];
  rowClasses.forEach((className, i) => {
    const color = className ? classToColor.get(className) : undefined;
    if (!color) return;
    const row0 = i + 1; // +1 for header
    requests.push({
      updateCells: {
        range: { sheetId, startRowIndex: row0, endRowIndex: row0 + 1, startColumnIndex: 0, endColumnIndex: 2 },
        rows: [{ values: [{ userEnteredFormat: { backgroundColor: color } }, { userEnteredFormat: { backgroundColor: color } }] }],
        fields: "userEnteredFormat.backgroundColor",
      },
    });
  });

  const CHUNK_SIZE = 400;
  for (let i = 0; i < requests.length; i += CHUNK_SIZE) {
    await sheetsClient.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: { requests: requests.slice(i, i + CHUNK_SIZE) },
    });
  }
  console.log(`Recolored ${requests.length} rows (columns A+B) by class.`);
}
