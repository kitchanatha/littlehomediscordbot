import { env } from "../config/env.js";
import { sheetsClient } from "../google/sheets-client.js";
import { normalizeName } from "../utils/normalize.js";

// Reverts the plain "Combat Power" column added to each class tab by
// push-combat-power-to-tabs.ts, replacing it with a single "Name (CP)" column that combines
// both as display text. Column A (the actual name column) is never touched — the attendance
// auto-check-in logic matches names there exactly, so it must stay exactly as members typed
// it at registration.
//
// Usage: npm run revert-and-combine-class-tabs

const spreadsheetId = env.GOOGLE_SHEET_ID;
const RAW_SHEET = "Game_Roster_CombatPower";
const CLASS_TABS = [
  "Knight", "Paladin", "Hunter", "Assassin", "Wizard",
  "Priest", "Monk", "Blacksmith", "Gunslinger", "Druid",
];
const OLD_HEADER = "Combat Power";
const NEW_HEADER = "Name (CP)";

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
  const headerRow = (await sheetsClient.spreadsheets.values.get({ spreadsheetId, range: `${tab}!1:1` })).data.values?.[0] ?? [];
  const oldColIndex0 = headerRow.indexOf(OLD_HEADER);

  if (oldColIndex0 < 0) {
    console.log(`SKIP ${tab}: no "${OLD_HEADER}" column found to revert`);
    continue;
  }

  const sheetId = sheetMeta.data.sheets?.find((s) => s.properties?.title === tab)?.properties?.sheetId;
  if (sheetId === undefined) {
    console.log(`SKIP ${tab}: sheet not found`);
    continue;
  }

  // Delete the plain Combat Power column entirely (a real revert, not just clearing values).
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
  console.log(`${tab}: removed old "${OLD_HEADER}" column at ${colLetter(oldColIndex0)}`);

  // Re-read the header now that the column is gone, to find the correct append position.
  const newHeaderRow = (await sheetsClient.spreadsheets.values.get({ spreadsheetId, range: `${tab}!1:1` })).data.values?.[0] ?? [];
  const newColIndex0 = newHeaderRow.length;
  const newColLetter = colLetter(newColIndex0);

  const names = (
    await sheetsClient.spreadsheets.values.get({ spreadsheetId, range: `${tab}!A2:A` })
  ).data.values ?? [];

  const values: string[][] = [[NEW_HEADER]];
  let matched = 0;
  for (const [name] of names) {
    if (!name) {
      values.push([""]);
      continue;
    }
    const cp = lookupCP(name);
    values.push([cp ? `${name} (${cp})` : name]);
    if (cp) matched++;
  }

  await sheetsClient.spreadsheets.values.update({
    spreadsheetId,
    range: `${tab}!${newColLetter}1:${newColLetter}${values.length}`,
    valueInputOption: "RAW",
    requestBody: { values },
  });
  console.log(`${tab}: added "${NEW_HEADER}" at column ${newColLetter}, combined ${matched}/${names.length}`);
}
