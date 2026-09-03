import { env } from "../config/env.js";
import { sheetsClient } from "../google/sheets-client.js";
import { normalizeName } from "../utils/normalize.js";

// Adds a real class-icon image (via IMAGE(), confirmed working once the sheet owner opens it
// in a browser once) as an appended "Icon" column across every tab that lists character names
// — Game_Roster_CombatPower, all 10 class tabs, เช็คขาด-ลา, and both queue display sheets.
// Icons are always appended after existing columns, never inserted, so nothing shifts. The war
// roster grid (รายชื่อตี้วอร์ห้องหลัก) is skipped — each of its cells already crams an emoji +
// name + CP into one cell, and a Sheets cell can't hold both an image and text at once.
//
// Usage: npm run add-class-icons

const spreadsheetId = env.GOOGLE_SHEET_ID;
const RAW_SHEET = "Game_Roster_CombatPower";
const CLASS_TABS = [
  "Knight", "Paladin", "Hunter", "Assassin", "Wizard",
  "Priest", "Monk", "Blacksmith", "Gunslinger", "Druid",
];
const ATTENDANCE_SHEET = "เช็คขาด-ลา";
const ATTENDANCE_NAME_COL0 = 1; // column B
const CARD_QUEUE_SHEET = "คิวการ์ดประดับ";
const ACCESSORY_QUEUE_SHEET = "คิวประดับ";
const ICON_SIZE = 30;

// Same 8 base-job-tree icons pulled from the reference game's own CDN, confirmed working.
const iconUrls: Record<string, string> = {
  Gunslinger: "https://cdnimages.awselbcombine.com/public_images/auto_system_upload/2026/06/1781591616667-53.png",
  Thief:      "https://cdnimages.awselbcombine.com/public_images/auto_system_upload/2026/06/1781591616803-59.png",
  Merchant:   "https://cdnimages.awselbcombine.com/public_images/auto_system_upload/2026/06/1781591616640-88.png",
  Archer:     "https://cdnimages.awselbcombine.com/public_images/auto_system_upload/2026/06/1781591616802-18.png",
  Swordman:   "https://cdnimages.awselbcombine.com/public_images/auto_system_upload/2026/06/1781591616681-99.png",
  Mage:       "https://cdnimages.awselbcombine.com/public_images/auto_system_upload/2026/06/1781591616659-64.png",
  Acolyte:    "https://cdnimages.awselbcombine.com/public_images/auto_system_upload/2026/06/1781591616665-72.png",
  Druid:      "https://cdnimages.awselbcombine.com/public_images/auto_system_upload/2026/06/1781591616683-60.png",
};

const classToIconUrl: Record<string, string> = {
  Knight: iconUrls.Swordman,
  Paladin: iconUrls.Swordman,
  Priest: iconUrls.Acolyte,
  Monk: iconUrls.Acolyte,
  Wizard: iconUrls.Mage,
  Hunter: iconUrls.Archer,
  Assassin: iconUrls.Thief,
  Blacksmith: iconUrls.Merchant,
  Gunslinger: iconUrls.Gunslinger,
  Druid: iconUrls.Druid,
};

function coreName(s: string): string {
  return normalizeName(s).replace(/[^a-z0-9ก-๙]/g, "");
}

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

function iconFormula(url: string): string {
  return `=IMAGE("${url}", 4, ${ICON_SIZE}, ${ICON_SIZE})`;
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

async function ensureColumnCapacity(sheetId: number, sheetName: string, neededCols: number): Promise<void> {
  const meta = await sheetsClient.spreadsheets.get({ spreadsheetId });
  const sheet = meta.data.sheets?.find((s) => s.properties?.sheetId === sheetId);
  const current = sheet?.properties?.gridProperties?.columnCount ?? 0;
  if (current >= neededCols) return;
  await sheetsClient.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [{ appendDimension: { sheetId, dimension: "COLUMNS", length: neededCols - current } }],
    },
  });
  console.log(`${sheetName}: grew to ${neededCols} columns`);
}

const sheetMeta = await sheetsClient.spreadsheets.get({ spreadsheetId });
function sheetIdOf(title: string): number | undefined {
  return sheetMeta.data.sheets?.find((s) => s.properties?.title === title)?.properties?.sheetId ?? undefined;
}

async function appendIconColumn(
  sheetName: string,
  nameColIndex0: number,
  lookupName: (cellValue: string) => string | null
): Promise<void> {
  const sheetId = sheetIdOf(sheetName);
  if (sheetId === undefined) {
    console.log(`SKIP ${sheetName}: sheet not found`);
    return;
  }
  const headerRow = (await sheetsClient.spreadsheets.values.get({ spreadsheetId, range: `${sheetName}!1:1` })).data.values?.[0] ?? [];
  if (headerRow.includes("Icon")) {
    console.log(`SKIP ${sheetName}: "Icon" column already exists`);
    return;
  }
  const newColIndex0 = headerRow.length;
  await ensureColumnCapacity(sheetId, sheetName, newColIndex0 + 1);
  const newColLetter = colLetter(newColIndex0);

  const nameColLetter = colLetter(nameColIndex0);
  const names = (
    await sheetsClient.spreadsheets.values.get({ spreadsheetId, range: `${sheetName}!${nameColLetter}2:${nameColLetter}` })
  ).data.values ?? [];

  const values: string[][] = [["Icon"]];
  let matched = 0;
  for (const [name] of names) {
    const className = name ? lookupName(name) : null;
    const url = className ? classToIconUrl[className] : undefined;
    values.push([url ? iconFormula(url) : ""]);
    if (url) matched++;
  }

  await sheetsClient.spreadsheets.values.update({
    spreadsheetId,
    range: `${sheetName}!${newColLetter}1:${newColLetter}${values.length}`,
    valueInputOption: "USER_ENTERED",
    requestBody: { values },
  });
  console.log(`${sheetName}: added Icon column at ${newColLetter}, matched ${matched}/${names.length}`);
}

// 1. Game_Roster_CombatPower — className already known per-row (column G), no lookup needed.
{
  const sheetId = sheetIdOf(RAW_SHEET);
  if (sheetId !== undefined) {
    const headerRow = (await sheetsClient.spreadsheets.values.get({ spreadsheetId, range: `${RAW_SHEET}!1:1` })).data.values?.[0] ?? [];
    if (!headerRow.includes("Icon")) {
      const newColIndex0 = headerRow.length;
      await ensureColumnCapacity(sheetId, RAW_SHEET, newColIndex0 + 1);
      const newColLetter = colLetter(newColIndex0);
      const values: string[][] = [["Icon"]];
      let matched = 0;
      for (const row of rawRows) {
        const className = row[6];
        const url = className ? classToIconUrl[className] : undefined;
        values.push([url ? iconFormula(url) : ""]);
        if (url) matched++;
      }
      await sheetsClient.spreadsheets.values.update({
        spreadsheetId,
        range: `${RAW_SHEET}!${newColLetter}1:${newColLetter}${values.length}`,
        valueInputOption: "USER_ENTERED",
        requestBody: { values },
      });
      console.log(`${RAW_SHEET}: added Icon column at ${newColLetter}, matched ${matched}/${rawRows.length}`);
    } else {
      console.log(`SKIP ${RAW_SHEET}: "Icon" column already exists`);
    }
  }
}

// 2. Each class tab — every name on that tab is that tab's own fixed class.
for (const className of CLASS_TABS) {
  await appendIconColumn(className, 0, () => className);
}

// 3. เช็คขาด-ลา — look up class via the consolidated roster.
await appendIconColumn(ATTENDANCE_SHEET, ATTENDANCE_NAME_COL0, lookupClass);

// 4. Both queue display sheets.
await appendIconColumn(CARD_QUEUE_SHEET, 0, lookupClass);
await appendIconColumn(ACCESSORY_QUEUE_SHEET, 0, lookupClass);

console.log("\nDone. (รายชื่อตี้วอร์ห้องหลัก skipped — its cells already combine emoji+name+CP as text.)");
