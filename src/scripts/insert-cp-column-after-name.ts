import { env } from "../config/env.js";
import { sheetsClient } from "../google/sheets-client.js";
import { normalizeName } from "../utils/normalize.js";

// Replaces the combined "Name (CP)" column (from revert-and-combine-class-tabs.ts) with a
// plain "Combat Power" column inserted right after the name column (column B), shifting the
// existing war-date attendance columns one to the right. This is safe: the attendance
// check-in code (findOrCreateDateColumn) finds date columns by scanning header content, not
// by a fixed column index, so it transparently skips over this new column and finds the
// (now-shifted) date columns exactly as before. Column A itself is never touched.
//
// Usage: npm run insert-cp-column-after-name

const spreadsheetId = env.GOOGLE_SHEET_ID;
const RAW_SHEET = "Game_Roster_CombatPower";
const CLASS_TABS = [
  "Knight", "Paladin", "Hunter", "Assassin", "Wizard",
  "Priest", "Monk", "Blacksmith", "Gunslinger", "Druid",
];
const OLD_HEADER = "Name (CP)";
const NEW_HEADER = "Combat Power";
const INSERT_AT_INDEX0 = 1; // column B, right after name (column A)

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

const sheetMeta = await sheetsClient.spreadsheets.get({ spreadsheetId });

for (const tab of CLASS_TABS) {
  const sheetId = sheetMeta.data.sheets?.find((s) => s.properties?.title === tab)?.properties?.sheetId;
  if (sheetId === undefined) {
    console.log(`SKIP ${tab}: sheet not found`);
    continue;
  }

  const headerRow = (await sheetsClient.spreadsheets.values.get({ spreadsheetId, range: `${tab}!1:1` })).data.values?.[0] ?? [];
  const oldColIndex0 = headerRow.indexOf(OLD_HEADER);
  if (oldColIndex0 >= 0) {
    await sheetsClient.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [{
          deleteDimension: {
            range: { sheetId, dimension: "COLUMNS", startIndex: oldColIndex0, endIndex: oldColIndex0 + 1 },
          },
        }],
      },
    });
    console.log(`${tab}: removed old "${OLD_HEADER}" column`);
  }

  // Insert a new column at B, shifting existing columns (name stays at A, dates shift right).
  await sheetsClient.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [{
        insertDimension: {
          range: { sheetId, dimension: "COLUMNS", startIndex: INSERT_AT_INDEX0, endIndex: INSERT_AT_INDEX0 + 1 },
          inheritFromBefore: false,
        },
      }],
    },
  });

  const names = (
    await sheetsClient.spreadsheets.values.get({ spreadsheetId, range: `${tab}!A2:A` })
  ).data.values ?? [];

  const values: string[][] = [[NEW_HEADER]];
  let matched = 0;
  for (const [name] of names) {
    const cp = name ? lookupCP(name) : null;
    values.push([cp ?? ""]);
    if (cp) matched++;
  }

  const colLetterStr = colLetter(INSERT_AT_INDEX0);
  await sheetsClient.spreadsheets.values.update({
    spreadsheetId,
    range: `${tab}!${colLetterStr}1:${colLetterStr}${values.length}`,
    valueInputOption: "RAW",
    requestBody: { values },
  });
  console.log(`${tab}: inserted "${NEW_HEADER}" at column ${colLetterStr}, matched ${matched}/${names.length}`);
}
