import { namesMatch } from "./normalize.js";

// The war-planning tabs (รายชื่อ Elite, ปาร์ตี้วันอังคาร, ปาร์ตี้วันพฤหัส, ศึกชิงปราสาท) are grids of
// team blocks. Each block is a header row reading "1 … 8" (the ตีบอส block reads "1 _ 2") followed
// by up to five rows of typed character names. Titles ("Team A", "Team ฟา [ Fariszme ]") and the
// header numbers sit outside those name rows and must never be treated as player names.
export const WAR_ROSTER_SHEETS = ["รายชื่อ Elite", "ปาร์ตี้วันอังคาร", "ปาร์ตี้วันพฤหัส", "ศึกชิงปราสาท"];
export const WAR_ROSTER_RANGE = "A1:H70";
const NAME_ROWS_PER_BLOCK = 5;
const MAX_COLS = 8; // A:H

const clean = (s: unknown) => String(s ?? "").normalize("NFC").trim();
const key = (s: unknown) => clean(s).toLowerCase();

function isBlockHeader(row: string[] | undefined): boolean {
  if (!row) return false;
  return clean(row[0]) === "1" && (clean(row[1]) === "2" || clean(row[2]) === "2");
}

/** 0-based indexes of every row that holds player names (the 5 rows under each "1 … 8" header). */
export function rosterNameRows(rows: string[][]): number[] {
  const out: number[] = [];
  rows.forEach((row, i) => {
    if (!isBlockHeader(row)) return;
    for (let r = i + 1; r <= i + NAME_ROWS_PER_BLOCK && r < rows.length; r++) {
      if (isBlockHeader(rows[r])) break; // a new block starts sooner than five rows later
      out.push(r);
    }
  });
  return out;
}

export interface RosterCell {
  row: number; // 0-based
  col: number; // 0-based
}

/**
 * Cells holding `characterName` inside the name rows. An exact (case/Unicode-normalised) match
 * always wins. Only when the tab has no exact match do we fall back to the bot's looser
 * namesMatch — and then never for a cell whose text is itself another member's exact name,
 * because loose matching treats look-alikes such as ไก่จ๊วบแซ่จิ๊บ / ไก่จ๊วบแซ่จุ๊บ as the same person.
 */
export function findRosterCells(rows: string[][], characterName: string, otherMemberNames: Set<string>): RosterCell[] {
  const nameRows = rosterNameRows(rows);
  const target = key(characterName);
  const exact: RosterCell[] = [];
  const loose: RosterCell[] = [];
  for (const r of nameRows) {
    const row = rows[r] ?? [];
    for (let c = 0; c < MAX_COLS; c++) {
      const text = clean(row[c]);
      if (!text || text.startsWith("=")) continue;
      if (key(text) === target) exact.push({ row: r, col: c });
      else if (!otherMemberNames.has(key(text)) && namesMatch(text, characterName)) loose.push({ row: r, col: c });
    }
  }
  return exact.length ? exact : loose;
}

export function a1(sheet: string, cell: RosterCell): string {
  return `${sheet}!${String.fromCharCode(65 + cell.col)}${cell.row + 1}`;
}
