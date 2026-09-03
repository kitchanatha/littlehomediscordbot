import { sheets_v4 } from "googleapis";
import { env } from "../config/env.js";
import { sheetsClient } from "../google/sheets-client.js";
import { hexToRgb } from "../utils/color.js";

// Proposes a balanced Team/Party split for the next War event: Team A/B/C (4 parties of 5
// each) plus a secondary room for everyone who doesn't fit, using each member's Combat Power
// and Class from Game_Roster_CombatPower (the durable, guild-linked source of truth).
//
// Every main party AND every secondary-room group of 5 is guaranteed at least one Priest
// (reserved up front, highest-CP priests first) so nobody ends up without a healer. All
// remaining members are then merged round-robin across classes — rather than exhausting the
// single largest class before moving to the next — so parties get a mix of roles instead of
// being dominated by whichever class happens to be biggest, while still filling whichever
// team/party has the lowest total CP or fewest members so far to keep things balanced.
//
// Never touches the live รายชื่อตี้วอร์ห้องหลัก sheet — writes to a new "War Plan (Draft)" tab.
//
// Usage: npm run plan-war-teams

const spreadsheetId = env.GOOGLE_SHEET_ID;
const RAW_SHEET = "Game_Roster_CombatPower";
const DRAFT_SHEET = "War Plan (Draft)";
const TEAM_NAMES = ["Team A", "Team B", "Team C"];
const PARTIES_PER_TEAM = 4;
const PARTY_SIZE = 5;
const PRIEST_CLASS = "Priest";
const SECONDARY_ROOM_NAME = "ห้องรอง (Secondary Room)";

type Member = { name: string; cp: number; className: string };

const classRows = (
  await sheetsClient.spreadsheets.values.get({ spreadsheetId, range: "Classes!A2:F" })
).data.values ?? [];
const classToColor = new Map<string, sheets_v4.Schema$Color>();
const classToSymbol = new Map<string, string>();
for (const row of classRows) {
  const className = row[1];
  const symbol = row[4];
  const colorHex = row[5];
  const rgb = colorHex ? hexToRgb(colorHex) : null;
  if (className && rgb) classToColor.set(className, rgb);
  if (className && symbol) classToSymbol.set(className, symbol);
}

const rawRows = (
  await sheetsClient.spreadsheets.values.get({ spreadsheetId, range: `${RAW_SHEET}!A2:G` })
).data.values ?? [];
const byClass = new Map<string, Member[]>();
for (const row of rawRows) {
  const [name, cpRaw, , , , , className] = row;
  const cp = Number((cpRaw ?? "0").toString().replace(/[^0-9.]/g, ""));
  if (!name || !className || !Number.isFinite(cp)) continue;
  const list = byClass.get(className) ?? [];
  list.push({ name, cp, className });
  byClass.set(className, list);
}
for (const list of byClass.values()) list.sort((a, b) => b.cp - a.cp);

type Party = Member[];
type Team = { name: string; totalCp: number; parties: Party[] };
const teams: Team[] = TEAM_NAMES.map((name) => ({
  name,
  totalCp: 0,
  parties: Array.from({ length: PARTIES_PER_TEAM }, () => []),
}));

function teamSize(t: Team): number {
  return t.parties.reduce((sum, p) => sum + p.length, 0);
}

// Pick the party (in the lowest-total-CP team) with room, or null if every main party is full.
function pickMainParty(): Party | null {
  const eligibleTeams = teams.filter((t) => teamSize(t) < PARTIES_PER_TEAM * PARTY_SIZE);
  if (eligibleTeams.length === 0) return null;
  const team = eligibleTeams.reduce((a, b) => (a.totalCp <= b.totalCp ? a : b));
  return team.parties.filter((p) => p.length < PARTY_SIZE).reduce((a, b) => (a.length <= b.length ? a : b));
}

function assignToMain(member: Member, party: Party): void {
  party.push(member);
  const team = teams.find((t) => t.parties.includes(party))!;
  team.totalCp += member.cp;
}

const mainCapacity = TEAM_NAMES.length * PARTIES_PER_TEAM * PARTY_SIZE;
const totalMembers = [...byClass.values()].reduce((sum, list) => sum + list.length, 0);
const overflowCount = Math.max(0, totalMembers - mainCapacity);

// Secondary groups mirror party rows (up to PARTY_SIZE each); the last one may be smaller.
const secondaryGroups: Party[] = [];
{
  let remaining = overflowCount;
  while (remaining > 0) {
    secondaryGroups.push([]);
    remaining -= Math.min(PARTY_SIZE, remaining);
  }
}
function secondaryCapacity(index: number): number {
  const isLast = index === secondaryGroups.length - 1;
  return isLast ? overflowCount - PARTY_SIZE * (secondaryGroups.length - 1) : PARTY_SIZE;
}
function pickSecondaryGroup(): Party | null {
  const eligible = secondaryGroups.filter((g, i) => g.length < secondaryCapacity(i));
  if (eligible.length === 0) return null;
  return eligible.reduce((a, b) => (a.length <= b.length ? a : b));
}

// Reserve one Priest per main party and per secondary group first, so nobody lacks a healer.
// Build the exact slot list up front (one entry per party/group) rather than reusing the
// general-fill pickers, which would happily stack every reserved priest into main parties
// before secondary groups ever got a look-in (main isn't "full" until all 60 slots are used).
type ReservationSlot = { party: Party; team?: Team };
const reservationSlots: ReservationSlot[] = [];
for (let round = 0; round < PARTIES_PER_TEAM; round++) {
  for (const team of teams) reservationSlots.push({ party: team.parties[round], team });
}
for (const group of secondaryGroups) reservationSlots.push({ party: group });

const priestPool = byClass.get(PRIEST_CLASS) ?? [];
const reservedPriests = priestPool.splice(0, Math.min(reservationSlots.length, priestPool.length));

reservedPriests.forEach((priest, i) => {
  const slot = reservationSlots[i];
  slot.party.push(priest);
  if (slot.team) slot.team.totalCp += priest.cp;
});

// Merge every remaining class round-robin (one member per class per pass) instead of
// exhausting the largest class first, so parties end up with a mix of roles.
const remainingClassNames = [...byClass.keys()];
const mergedOrder: Member[] = [];
let anyLeft = true;
while (anyLeft) {
  anyLeft = false;
  for (const className of remainingClassNames) {
    const list = byClass.get(className)!;
    if (list.length === 0) continue;
    mergedOrder.push(list.shift()!);
    anyLeft = true;
  }
}

for (const member of mergedOrder) {
  const party = pickMainParty();
  if (party) {
    assignToMain(member, party);
    continue;
  }
  const group = pickSecondaryGroup();
  if (group) group.push(member);
}

// Build the sheet grid: per team, a title row, a slot-number header row, then each party as
// its own COLUMN with members stacked vertically down the rows below it (rather than each
// party as one wide row) — easier to read down a party's roster top to bottom.
const values: (string | number)[][] = [];
const colorPlan: { row0: number; col0: number; color: sheets_v4.Schema$Color }[] = [];

function writeGroupsVertically(groups: Party[], columnLabels: string[]): void {
  const headerRow0 = values.length;
  values.push(columnLabels);
  const maxSize = Math.max(...groups.map((g) => g.length), 0);
  for (let row = 0; row < maxSize; row++) {
    const line: string[] = [];
    groups.forEach((group, colIndex) => {
      const m = group[row];
      if (!m) return;
      const symbol = classToSymbol.get(m.className) ?? "";
      line[colIndex] = `${symbol} ${m.name} (${m.cp})`;
      const color = classToColor.get(m.className);
      if (color) colorPlan.push({ row0: headerRow0 + 1 + row, col0: colIndex, color });
    });
    values.push(line);
  }
}

for (const team of teams) {
  const size = teamSize(team);
  if (size === 0) continue;
  const classCounts = new Map<string, number>();
  for (const party of team.parties) for (const m of party) classCounts.set(m.className, (classCounts.get(m.className) ?? 0) + 1);
  const breakdown = [...classCounts.entries()].map(([c, n]) => `${c} x${n}`).join(", ");

  values.push([`${team.name} — ${size} members, total CP ${team.totalCp.toLocaleString()}`]);
  values.push([breakdown]);
  writeGroupsVertically(team.parties, team.parties.map((_, i) => `Party ${i + 1}`));
  values.push([]);
}

if (secondaryGroups.length > 0) {
  const allSecondaryMembers = secondaryGroups.flat();
  const totalCp = allSecondaryMembers.reduce((sum, m) => sum + m.cp, 0);
  const classCounts = new Map<string, number>();
  for (const m of allSecondaryMembers) classCounts.set(m.className, (classCounts.get(m.className) ?? 0) + 1);
  const breakdown = [...classCounts.entries()].map(([c, n]) => `${c} x${n}`).join(", ");

  values.push([`${SECONDARY_ROOM_NAME} — ${allSecondaryMembers.length} members, total CP ${totalCp.toLocaleString()}`]);
  values.push([breakdown]);
  writeGroupsVertically(secondaryGroups, secondaryGroups.map((_, i) => `Group ${i + 1}`));
}

const sheetMeta = await sheetsClient.spreadsheets.get({ spreadsheetId });
let sheetId = sheetMeta.data.sheets?.find((s) => s.properties?.title === DRAFT_SHEET)?.properties?.sheetId;

if (sheetId === undefined) {
  const addRes = await sheetsClient.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: { requests: [{ addSheet: { properties: { title: DRAFT_SHEET } } }] },
  });
  sheetId = addRes.data.replies?.[0]?.addSheet?.properties?.sheetId ?? undefined;
} else {
  // Clear any previous draft's values AND cell background color before writing the new one —
  // values.clear() alone leaves stale colors behind outside the new (possibly smaller) grid.
  await sheetsClient.spreadsheets.values.clear({ spreadsheetId, range: DRAFT_SHEET });
  const draftSheet = sheetMeta.data.sheets?.find((s) => s.properties?.sheetId === sheetId);
  const rowCount = draftSheet?.properties?.gridProperties?.rowCount ?? 1000;
  const columnCount = draftSheet?.properties?.gridProperties?.columnCount ?? 26;
  await sheetsClient.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [{
        repeatCell: {
          range: { sheetId, startRowIndex: 0, endRowIndex: rowCount, startColumnIndex: 0, endColumnIndex: columnCount },
          cell: { userEnteredFormat: { backgroundColor: { red: 1, green: 1, blue: 1 } } },
          fields: "userEnteredFormat.backgroundColor",
        },
      }],
    },
  });
}

await sheetsClient.spreadsheets.values.update({
  spreadsheetId,
  range: `${DRAFT_SHEET}!A1`,
  valueInputOption: "RAW",
  requestBody: { values },
});

if (sheetId !== undefined && colorPlan.length > 0) {
  const requests: sheets_v4.Schema$Request[] = colorPlan.map(({ row0, col0, color }) => ({
    updateCells: {
      range: { sheetId, startRowIndex: row0, endRowIndex: row0 + 1, startColumnIndex: col0, endColumnIndex: col0 + 1 },
      rows: [{ values: [{ userEnteredFormat: { backgroundColor: color } }] }],
      fields: "userEnteredFormat.backgroundColor",
    },
  }));
  const CHUNK_SIZE = 400;
  for (let i = 0; i < requests.length; i += CHUNK_SIZE) {
    await sheetsClient.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: { requests: requests.slice(i, i + CHUNK_SIZE) },
    });
  }
}

console.log(`\nWrote proposal to "${DRAFT_SHEET}":`);
for (const team of teams) {
  const size = teamSize(team);
  if (size === 0) continue;
  const partiesWithPriest = team.parties.filter((p) => p.some((m) => m.className === PRIEST_CLASS)).length;
  console.log(
    `  ${team.name}: ${size} members, total CP ${team.totalCp.toLocaleString()}, avg CP ${Math.round(team.totalCp / size).toLocaleString()}, ` +
    `${partiesWithPriest}/${team.parties.length} parties have a Priest`,
  );
}
if (secondaryGroups.length > 0) {
  const allSecondaryMembers = secondaryGroups.flat();
  const totalCp = allSecondaryMembers.reduce((sum, m) => sum + m.cp, 0);
  const priestGroups = secondaryGroups.filter((g) => g.some((m) => m.className === PRIEST_CLASS)).length;
  console.log(
    `  ${SECONDARY_ROOM_NAME}: ${allSecondaryMembers.length} members in ${secondaryGroups.length} groups, ` +
    `total CP ${totalCp.toLocaleString()}, ${priestGroups}/${secondaryGroups.length} groups have a Priest`,
  );
}
