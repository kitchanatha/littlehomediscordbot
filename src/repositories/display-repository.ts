import { sheets_v4 } from "googleapis";
import { env } from "../config/env.js";
import { sheetsClient } from "../google/sheets-client.js";
import { hexToRgb } from "../utils/color.js";
import type { PlayerDisplay } from "../types/class.js";

const SHEETS = {
  warRosterTemplate: "War_Roster_Template",
  mainWarRoster: "รายชื่อห้องวอห้องหลัก",
  eliteBoss: "รายชื่อ elite บอสวันอาทิตย์",
  sundayWar: "ตี้วอวันอาทิตย์",
  attendance: "เช็คขาดลา",
} as const;

export interface SheetDisplayRepository {
  refreshPlayerDisplays(sheetName: string, displays: { range: string; display: PlayerDisplay }[]): Promise<void>;
  findPlayerCells(sheetName: string, characterNames: string[]): Promise<{ range: string; characterName: string }[]>;
  getSheetNames(): Promise<string[]>;
}

export class GoogleSheetsDisplayRepository implements SheetDisplayRepository {
  private readonly sheets: sheets_v4.Sheets = sheetsClient;
  private readonly spreadsheetId = env.GOOGLE_SHEET_ID;
  private sheetIds = new Map<string, number>();

  private async ensureSheetIds(): Promise<void> {
    if (this.sheetIds.size) return;
    const response = await this.sheets.spreadsheets.get({ spreadsheetId: this.spreadsheetId });
    for (const sheet of response.data.sheets ?? []) {
      const title = sheet.properties?.title;
      const id = sheet.properties?.sheetId;
      if (title && id !== undefined && id !== null) this.sheetIds.set(title, id);
    }
  }

  async getSheetNames(): Promise<string[]> {
    await this.ensureSheetIds();
    return Array.from(this.sheetIds.keys());
  }

  async refreshPlayerDisplays(sheetName: string, displays: { range: string; display: PlayerDisplay }[]): Promise<void> {
    await this.ensureSheetIds();
    const sheetId = this.sheetIds.get(sheetName);
    if (sheetId === undefined) return;

    const requests: sheets_v4.Schema$Request[] = [];

    for (const item of displays) {
      const range = this.parseRange(item.range);
      if (!range) continue;

      // Update text
      requests.push({
        updateCells: {
          range: {
            sheetId,
            startRowIndex: range.startRow,
            endRowIndex: range.endRow,
            startColumnIndex: range.startCol,
            endColumnIndex: range.endCol,
          },
          rows: [{ values: [{ userEnteredValue: { stringValue: item.display.text } }] }],
          fields: "userEnteredValue",
        },
      });

      // Update background color
      const rgb = item.display.colorHex ? hexToRgb(item.display.colorHex) : { red: 1, green: 1, blue: 1 };
      requests.push({
        updateCells: {
          range: {
            sheetId,
            startRowIndex: range.startRow,
            endRowIndex: range.endRow,
            startColumnIndex: range.startCol,
            endColumnIndex: range.endCol,
          },
          rows: [{ values: [{ userEnteredFormat: { backgroundColor: rgb as sheets_v4.Schema$Color } } ] }],
          fields: "userEnteredFormat.backgroundColor",
        },
      });
    }

    if (requests.length > 0) {
      await this.sheets.spreadsheets.batchUpdate({
        spreadsheetId: this.spreadsheetId,
        requestBody: { requests },
      });
    }
  }

  async findPlayerCells(sheetName: string, characterNames: string[]): Promise<{ range: string; characterName: string }[]> {
    // This is a simplified implementation. In a real scenario, we might want to fetch the whole sheet and search.
    // For now, we'll fetch A1:Z100 as a reasonable range for rosters.
    const response = await this.sheets.spreadsheets.values.get({
      spreadsheetId: this.spreadsheetId,
      range: `${sheetName}!A1:Z100`,
    });

    const values = response.data.values || [];
    const results: { range: string; characterName: string }[] = [];
    const nameSet = new Set(characterNames);

    for (let r = 0; r < values.length; r++) {
      for (let c = 0; c < values[r].length; c++) {
        const cellValue = String(values[r][c] || "").trim();
        // Check if cell contains the name (might have symbol already or be just the name)
        for (const name of nameSet) {
          if (cellValue === name || cellValue.endsWith(" " + name) || cellValue.endsWith(name)) {
             const colLetter = String.fromCharCode(65 + c);
             results.push({
               range: `${colLetter}${r + 1}`,
               characterName: name
             });
          }
        }
      }
    }

    return results;
  }

  private parseRange(range: string): { startRow: number; endRow: number; startCol: number; endCol: number } | null {
    // Supports "A1" or "A1:B2"
    const match = /^([A-Z]+)([0-9]+)(?::([A-Z]+)([0-9]+))?$/.exec(range);
    if (!match) return null;

    const startCol = this.colToNumber(match[1]);
    const startRow = parseInt(match[2]) - 1;
    let endCol = startCol + 1;
    let endRow = startRow + 1;

    if (match[3] && match[4]) {
      endCol = this.colToNumber(match[3]) + 1;
      endRow = parseInt(match[4]);
    }

    return { startRow, endRow, startCol, endCol };
  }

  private colToNumber(col: string): number {
    let num = 0;
    for (let i = 0; i < col.length; i++) {
      num = num * 26 + (col.charCodeAt(i) - 64);
    }
    return num - 1;
  }
}
