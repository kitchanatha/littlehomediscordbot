// Ingests one week's captured guild roster data (Rating / Weekly Contribution / Historical
// Contribution — read off the in-game Guild > Members screen, one screenshot per page) and:
//   1. Appends a dated row per member to GuildStats_History (the permanent log — never
//      overwritten, so long-term trends stay available).
//   2. Rebuilds GuildStats_Latest — a compare-at-a-glance view: this week's numbers plus the
//      change since each member's previous captured entry.
//   3. Updates Members!L:N (Rating, WeeklyContribution, HistoricalContribution) so the main
//      roster always reflects the latest capture.
//
// Input: a JSON file of [{ characterName, rating, weeklyContribution, historicalContribution }, ...]
// (weeklyContribution/historicalContribution are the two halves of the "week/historical" stat
// shown on the roster screen, e.g. "810/22269" -> weeklyContribution: 810, historicalContribution: 22269).
//
// Usage: npx tsx src/scripts/capture-guild-stats.ts path/to/capture.json

import { readFileSync } from "node:fs";
import { env } from "../config/env.js";
import { sheetsClient } from "../google/sheets-client.js";
import { namesMatch } from "../utils/normalize.js";

const spreadsheetId = env.GOOGLE_SHEET_ID;
const HISTORY_SHEET = "GuildStats_History";
const LATEST_SHEET = "GuildStats_Latest";

interface CaptureEntry {
  characterName: string;
  rating: number;
  weeklyContribution: number;
  historicalContribution: number;
}

async function main() {
  const inputPath = process.argv[2];
  if (!inputPath) {
    console.error("Usage: npx tsx src/scripts/capture-guild-stats.ts path/to/capture.json");
    process.exit(1);
  }

  const entries: CaptureEntry[] = JSON.parse(readFileSync(inputPath, "utf-8"));
  if (entries.length === 0) {
    console.error("Input file has no entries.");
    process.exit(1);
  }

  const capturedAt = new Date().toISOString().slice(0, 10);

  const historyRows = (
    await sheetsClient.spreadsheets.values.get({ spreadsheetId, range: `${HISTORY_SHEET}!A2:E` })
  ).data.values ?? [];

  // Most recent PRIOR entry per character (skip today's date in case this script re-runs the
  // same day — comparisons should always be against the previous distinct capture).
  const previousByName = new Map<string, { rating: number; weeklyContribution: number; historicalContribution: number; capturedAt: string }>();
  for (const row of historyRows) {
    const [date, name, rating, weekly, historical] = row;
    if (!date || !name || date === capturedAt) continue;
    const existing = previousByName.get(name);
    if (!existing || date > existing.capturedAt) {
      previousByName.set(name, {
        rating: Number(rating),
        weeklyContribution: Number(weekly),
        historicalContribution: Number(historical),
        capturedAt: date,
      });
    }
  }

  const appendRows = entries.map((e) => [capturedAt, e.characterName, e.rating, e.weeklyContribution, e.historicalContribution]);
  await sheetsClient.spreadsheets.values.append({
    spreadsheetId,
    range: `${HISTORY_SHEET}!A:E`,
    valueInputOption: "RAW",
    insertDataOption: "INSERT_ROWS",
    requestBody: { values: appendRows },
  });
  console.log(`Appended ${appendRows.length} row(s) to ${HISTORY_SHEET} for ${capturedAt}`);

  const latestRows = entries.map((e) => {
    const prev = previousByName.get(e.characterName);
    const ratingChange = prev ? e.rating - prev.rating : "";
    const historicalChange = prev ? e.historicalContribution - prev.historicalContribution : "";
    return [e.characterName, e.rating, ratingChange, e.weeklyContribution, e.historicalContribution, historicalChange, capturedAt];
  });
  await sheetsClient.spreadsheets.values.update({
    spreadsheetId,
    range: `${LATEST_SHEET}!A2:G${latestRows.length + 1}`,
    valueInputOption: "RAW",
    requestBody: { values: latestRows },
  });
  console.log(`Rebuilt ${LATEST_SHEET} with ${latestRows.length} member(s)`);

  // Update Members!L:N, matching by CharacterName (namesMatch handles alt-name/decoration
  // differences the same way the rest of the bot does).
  const memberRows = (await sheetsClient.spreadsheets.values.get({ spreadsheetId, range: "Members!A2:D" })).data.values ?? [];
  const memberUpdates: { range: string; values: (string | number)[][] }[] = [];
  for (const e of entries) {
    const idx = memberRows.findIndex((r) => namesMatch(r[3] ?? "", e.characterName));
    if (idx < 0) {
      console.warn(`WARN "${e.characterName}" not found on Members tab — skipping roster update (still logged to history).`);
      continue;
    }
    memberUpdates.push({
      range: `Members!L${idx + 2}:N${idx + 2}`,
      values: [[e.rating, e.weeklyContribution, e.historicalContribution]],
    });
  }
  if (memberUpdates.length > 0) {
    await sheetsClient.spreadsheets.values.batchUpdate({
      spreadsheetId,
      requestBody: { valueInputOption: "RAW", data: memberUpdates },
    });
  }
  console.log(`Updated Members!L:N for ${memberUpdates.length}/${entries.length} member(s)`);

  // Console summary: biggest rating movers.
  const withChange = entries
    .map((e) => ({ name: e.characterName, change: previousByName.has(e.characterName) ? e.rating - previousByName.get(e.characterName)!.rating : null }))
    .filter((x) => x.change !== null) as { name: string; change: number }[];
  withChange.sort((a, b) => b.change - a.change);
  console.log("\nBiggest Rating gainers:");
  withChange.slice(0, 5).forEach((x) => console.log(`  ${x.name}: ${x.change >= 0 ? "+" : ""}${x.change}`));
  console.log("Biggest Rating drops:");
  withChange
    .slice(-5)
    .reverse()
    .forEach((x) => console.log(`  ${x.name}: ${x.change >= 0 ? "+" : ""}${x.change}`));

  const newMembers = entries.filter((e) => !previousByName.has(e.characterName));
  if (newMembers.length > 0) {
    console.log(`\n${newMembers.length} member(s) captured for the first time (no prior comparison): ${newMembers.map((m) => m.characterName).join(", ")}`);
  }
}

main().then(() => process.exit(0));
