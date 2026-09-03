import { sheets_v4 } from "googleapis";
import { env } from "../config/env.js";
import { sheetsClient } from "../google/sheets-client.js";
import { normalizeName } from "../utils/normalize.js";
import type { AttendanceRepository } from "./attendance-repository.js";
import type { AttendanceResult, AttendanceStatus } from "../types/attendance.js";

// Must match the tab name that actually exists in the connected Google Sheet.
const MASTER_SHEET = "เช็คขาด-ลา";

// Column layout on the master sheet: A = index number, B = character name, C+ = one column per War date.
const MASTER_NAME_COL = 1;
const MASTER_FIRST_DATE_COL = 2;

// Column layout on each class tab: A = character name, B+ = one column per War date.
const CLASS_NAME_COL = 0;
const CLASS_FIRST_DATE_COL = 1;

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

function buddhistParts(date: Date): { d: number; m: number; yy: number } {
  const d = date.getDate();
  const m = date.getMonth() + 1;
  const buddhistYear = date.getFullYear() + 543;
  return { d, m, yy: buddhistYear % 100 };
}

// The guild's existing headers are inconsistently typed ("war 31/7/69", "War  13/8/69", ...).
// New columns the bot creates always use this exact format so future lookups stay reliable.
function canonicalHeader(date: Date): string {
  const { d, m, yy } = buddhistParts(date);
  return `War ${d}/${m}/${yy}`;
}

// Lenient match against whatever format is already in the sheet.
function headerMatchesDate(header: string, date: Date): boolean {
  const match = /(\d{1,2})\s*\/\s*(\d{1,2})\s*\/\s*(\d{2,4})/.exec(header);
  if (!match) return false;
  const d = parseInt(match[1], 10);
  const m = parseInt(match[2], 10);
  let y = parseInt(match[3], 10);
  if (y >= 100) y = y % 100;
  const target = buddhistParts(date);
  return d === target.d && m === target.m && y === target.yy;
}

export class GoogleSheetsAttendanceRepository implements AttendanceRepository {
  private readonly sheets: sheets_v4.Sheets = sheetsClient;
  private readonly spreadsheetId = env.GOOGLE_SHEET_ID;
  private sheetIds = new Map<string, number>();
  private sheetRowCounts = new Map<string, number>();
  private sheetColumnCounts = new Map<string, number>();

  private async ensureSheetIds(): Promise<void> {
    if (this.sheetIds.size) return;
    const response = await this.sheets.spreadsheets.get({ spreadsheetId: this.spreadsheetId });
    for (const sheet of response.data.sheets ?? []) {
      const title = sheet.properties?.title;
      const id = sheet.properties?.sheetId;
      if (title && id !== undefined && id !== null) {
        this.sheetIds.set(title, id);
        const rowCount = sheet.properties?.gridProperties?.rowCount;
        if (rowCount) this.sheetRowCounts.set(title, rowCount);
        const columnCount = sheet.properties?.gridProperties?.columnCount;
        if (columnCount) this.sheetColumnCounts.set(title, columnCount);
      }
    }
  }

  private async values(range: string): Promise<string[][]> {
    const response = await this.sheets.spreadsheets.values.get({
      spreadsheetId: this.spreadsheetId,
      range,
    });
    return (response.data.values ?? []) as string[][];
  }

  // A GridRange/A1 write past the sheet's current column or row count fails with
  // "exceeds grid limits" instead of auto-expanding, so grow the grid first whenever
  // a write needs to land past what the sheet currently has.
  private async ensureColumnCapacity(sheetName: string, sheetId: number, requiredCol0: number): Promise<void> {
    const current = this.sheetColumnCounts.get(sheetName) ?? 0;
    if (requiredCol0 < current) return;
    const target = requiredCol0 + 1;
    await this.sheets.spreadsheets.batchUpdate({
      spreadsheetId: this.spreadsheetId,
      requestBody: {
        requests: [{ appendDimension: { sheetId, dimension: "COLUMNS", length: target - current } }],
      },
    });
    this.sheetColumnCounts.set(sheetName, target);
  }

  private async ensureRowCapacity(sheetName: string, sheetId: number, requiredRow1: number): Promise<void> {
    const current = this.sheetRowCounts.get(sheetName) ?? 0;
    if (requiredRow1 <= current) return;
    await this.sheets.spreadsheets.batchUpdate({
      spreadsheetId: this.spreadsheetId,
      requestBody: {
        requests: [{ appendDimension: { sheetId, dimension: "ROWS", length: requiredRow1 - current } }],
      },
    });
    this.sheetRowCounts.set(sheetName, requiredRow1);
  }

  private async findOrCreateDateColumn(sheetName: string, sheetId: number, firstDateCol: number, at: Date): Promise<number> {
    const headerRow = (await this.values(`${sheetName}!1:1`))[0] ?? [];

    for (let c = firstDateCol; c < headerRow.length; c++) {
      if (headerRow[c] && headerMatchesDate(headerRow[c], at)) return c;
    }

    let insertCol = firstDateCol;
    while (headerRow[insertCol]) insertCol++;

    await this.ensureColumnCapacity(sheetName, sheetId, insertCol);

    await this.sheets.spreadsheets.values.update({
      spreadsheetId: this.spreadsheetId,
      range: `${sheetName}!${colLetter(insertCol)}1`,
      valueInputOption: "RAW",
      requestBody: { values: [[canonicalHeader(at)]] },
    });

    return insertCol;
  }

  private async findOrCreateNameRow(sheetName: string, sheetId: number, nameCol: number, name: string): Promise<number> {
    const letter = colLetter(nameCol);
    const columnValues = (await this.values(`${sheetName}!${letter}2:${letter}`)).map((r) => r[0] ?? "");
    const target = normalizeName(name);
    const idx = columnValues.findIndex((v) => normalizeName(v) === target);
    if (idx >= 0) return idx + 2; // header is row 1; column data starts at A2

    const nextRow = columnValues.length + 2;
    await this.ensureRowCapacity(sheetName, sheetId, nextRow);

    const appendResponse = await this.sheets.spreadsheets.values.append({
      spreadsheetId: this.spreadsheetId,
      range: `${sheetName}!${letter}:${letter}`,
      valueInputOption: "RAW",
      insertDataOption: "INSERT_ROWS",
      requestBody: { values: [[name]] },
    });

    const updatedRange = appendResponse.data.updates?.updatedRange ?? "";
    const rowMatch = /![A-Z]+(\d+)/.exec(updatedRange);
    if (!rowMatch) throw new Error(`Could not determine the row Google Sheets used for "${name}" in ${sheetName}`);
    return parseInt(rowMatch[1], 10);
  }

  private async writeMark(
    sheetName: string,
    nameCol: number,
    firstDateCol: number,
    name: string,
    status: AttendanceStatus,
    at: Date
  ): Promise<string> {
    await this.ensureSheetIds();
    const sheetId = this.sheetIds.get(sheetName);
    if (sheetId === undefined) throw new Error(`Sheet "${sheetName}" not found`);

    const dateCol = await this.findOrCreateDateColumn(sheetName, sheetId, firstDateCol, at);
    const rowNumber = await this.findOrCreateNameRow(sheetName, sheetId, nameCol, name);

    await this.sheets.spreadsheets.values.update({
      spreadsheetId: this.spreadsheetId,
      range: `${sheetName}!${colLetter(dateCol)}${rowNumber}`,
      valueInputOption: "RAW",
      requestBody: { values: [[status]] },
    });

    return canonicalHeader(at);
  }

  async markAttendance(characterName: string, className: string, status: AttendanceStatus, at: Date): Promise<AttendanceResult> {
    let dateLabel = canonicalHeader(at);
    let markedMaster = false;
    let markedClassTab = false;

    try {
      dateLabel = await this.writeMark(MASTER_SHEET, MASTER_NAME_COL, MASTER_FIRST_DATE_COL, characterName, status, at);
      markedMaster = true;
    } catch (error) {
      console.error(`ERROR Failed to mark attendance on "${MASTER_SHEET}" for ${characterName}`, error);
    }

    if (className) {
      try {
        dateLabel = await this.writeMark(className, CLASS_NAME_COL, CLASS_FIRST_DATE_COL, characterName, status, at);
        markedClassTab = true;
      } catch (error) {
        console.error(`ERROR Failed to mark attendance on class tab "${className}" for ${characterName}`, error);
      }
    }

    return { dateLabel, markedMaster, markedClassTab };
  }

  async validateReadiness(): Promise<void> {
    await this.ensureSheetIds();
    if (!this.sheetIds.has(MASTER_SHEET)) {
      throw new Error(`Attendance database is not initialized: missing sheet "${MASTER_SHEET}"`);
    }
  }
}
