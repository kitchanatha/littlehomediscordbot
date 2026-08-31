import { sheets_v4 } from "googleapis";
import { env } from "../config/env.js";
import { sheetsClient } from "../google/sheets-client.js";
import { QueueEntry, QueueHistory, QueueType } from "../types/queue.js";
import { QueueRepository, VisualQueueMember } from "./queue-repository.js";
import { hexToRgb } from "../utils/color.js";

const SHEETS = {
  queueEntries: "Queue_Entries",
  queueHistory: "Queue_History",
  visualDisplay: "คิวการ์ด คิวประดับ",
} as const;

export class GoogleSheetsQueueRepository implements QueueRepository {
  private readonly sheets: sheets_v4.Sheets = sheetsClient;
  private readonly spreadsheetId = env.GOOGLE_SHEET_ID;
  private sheetIds = new Map<string, number>();

  private async values(range: string): Promise<string[][]> {
    const response = await this.sheets.spreadsheets.values.get({
      spreadsheetId: this.spreadsheetId,
      range,
    });
    return (response.data.values ?? []) as string[][];
  }

  private async ensureSheetIds(): Promise<void> {
    if (this.sheetIds.size) return;
    const response = await this.sheets.spreadsheets.get({ spreadsheetId: this.spreadsheetId });
    for (const sheet of response.data.sheets ?? []) {
      const title = sheet.properties?.title;
      const id = sheet.properties?.sheetId;
      if (title && id !== undefined && id !== null) this.sheetIds.set(title, id);
    }
  }

  private stringCell(value: string | number): sheets_v4.Schema$CellData {
    return { userEnteredValue: { stringValue: String(value) } };
  }

  private entryFromRow(row: string[]): QueueEntry {
    return {
      queueEntryId: row[0] ?? "",
      queueType: row[1] as QueueType,
      memberId: row[2] ?? "",
      discordId: row[3] ?? "",
      position: Number(row[4] ?? 0),
      status: row[5] as any,
      queuedAt: row[6] ?? "",
      addedBy: row[7] ?? "",
      lastUpdated: row[8] ?? "",
    };
  }

  async getAllActiveEntries(queueType: QueueType): Promise<QueueEntry[]> {
    const rows = await this.values(`${SHEETS.queueEntries}!A2:I`);
    return rows
      .map((row) => this.entryFromRow(row))
      .filter((e) => e.queueType === queueType && e.status === "Active")
      .sort((a, b) => a.position - b.position);
  }

  async findActiveEntry(discordId: string, queueType: QueueType): Promise<QueueEntry | null> {
    const rows = await this.values(`${SHEETS.queueEntries}!A2:I`);
    const row = rows.find((r) => r[3] === discordId && r[1] === queueType && r[5] === "Active");
    return row ? this.entryFromRow(row) : null;
  }

  async getLastHistory(discordId: string, queueType: QueueType): Promise<QueueHistory | null> {
    const rows = await this.values(`${SHEETS.queueHistory}!A2:J`);
    const relevant = rows
      .filter((r) => r[4] === discordId && r[2] === queueType && r[5] === "DEQUEUE")
      .map((row) => ({
        historyId: row[0] ?? "",
        queueEntryId: row[1] ?? "",
        queueType: row[2] as QueueType,
        memberId: row[3] ?? "",
        discordId: row[4] ?? "",
        action: row[5] as any,
        position: Number(row[6] ?? 0),
        changedAt: row[7] ?? "",
        changedBy: row[8] ?? "",
        cooldownUntil: row[9] ?? "",
      }));

    if (relevant.length === 0) return null;
    return relevant.sort((a, b) => b.changedAt.localeCompare(a.changedAt))[0];
  }

  async addEntry(entry: QueueEntry): Promise<void> {
    await this.sheets.spreadsheets.values.append({
      spreadsheetId: this.spreadsheetId,
      range: `${SHEETS.queueEntries}!A:I`,
      valueInputOption: "RAW",
      insertDataOption: "INSERT_ROWS",
      requestBody: {
        values: [[
          entry.queueEntryId,
          entry.queueType,
          entry.memberId,
          entry.discordId,
          entry.position,
          entry.status,
          entry.queuedAt,
          entry.addedBy,
          entry.lastUpdated,
        ]],
      },
    });
  }

  async updateEntries(entries: QueueEntry[]): Promise<void> {
    if (entries.length === 0) return;
    await this.ensureSheetIds();
    const sheetId = this.sheetIds.get(SHEETS.queueEntries);
    if (sheetId === undefined) throw new Error("Queue_Entries sheet missing");

    const allRows = await this.values(`${SHEETS.queueEntries}!A2:I`);
    
    const requests: sheets_v4.Schema$Request[] = entries.map((entry) => {
      const rowIndex = allRows.findIndex((r) => r[0] === entry.queueEntryId);
      if (rowIndex < 0) throw new Error(`Entry ${entry.queueEntryId} not found for update`);
      const sheetRow = rowIndex + 1; // row 1 is header, A2 is index 0

      return {
        updateCells: {
          range: {
            sheetId,
            startRowIndex: sheetRow,
            endRowIndex: sheetRow + 1,
            startColumnIndex: 0,
            endColumnIndex: 9,
          },
          rows: [{
            values: [
              this.stringCell(entry.queueEntryId),
              this.stringCell(entry.queueType),
              this.stringCell(entry.memberId),
              this.stringCell(entry.discordId),
              this.stringCell(entry.position),
              this.stringCell(entry.status),
              this.stringCell(entry.queuedAt),
              this.stringCell(entry.addedBy),
              this.stringCell(entry.lastUpdated),
            ],
          }],
          fields: "userEnteredValue",
        },
      };
    });

    await this.sheets.spreadsheets.batchUpdate({
      spreadsheetId: this.spreadsheetId,
      requestBody: { requests },
    });
  }

  async deleteEntry(queueEntryId: string): Promise<void> {
    await this.ensureSheetIds();
    const sheetId = this.sheetIds.get(SHEETS.queueEntries);
    if (sheetId === undefined) throw new Error("Queue_Entries sheet missing");

    const rows = await this.values(`${SHEETS.queueEntries}!A2:A`);
    const rowIndex = rows.findIndex((r) => r[0] === queueEntryId);
    if (rowIndex < 0) return; // Already gone or not found

    const sheetRow = rowIndex + 1;

    await this.sheets.spreadsheets.batchUpdate({
      spreadsheetId: this.spreadsheetId,
      requestBody: {
        requests: [{
          deleteDimension: {
            range: {
              sheetId,
              dimension: "ROWS",
              startIndex: sheetRow,
              endIndex: sheetRow + 1,
            },
          },
        }],
      },
    });
  }

  async addHistory(history: QueueHistory): Promise<void> {
    await this.sheets.spreadsheets.values.append({
      spreadsheetId: this.spreadsheetId,
      range: `${SHEETS.queueHistory}!A:J`,
      valueInputOption: "RAW",
      insertDataOption: "INSERT_ROWS",
      requestBody: {
        values: [[
          history.historyId,
          history.queueEntryId,
          history.queueType,
          history.memberId,
          history.discordId,
          history.action,
          history.position,
          history.changedAt,
          history.changedBy,
          history.cooldownUntil,
        ]],
      },
    });
  }

  async getAllHistoryIds(): Promise<string[]> {
    const rows = await this.values(`${SHEETS.queueHistory}!A2:A`);
    return rows.map((r) => r[0]).filter(Boolean);
  }

  async getAllEntryIds(): Promise<string[]> {
    const rows = await this.values(`${SHEETS.queueEntries}!A2:A`);
    return rows.map((r) => r[0]).filter(Boolean);
  }

  private formatDisplayDate(isoString: string): string {
    if (!isoString) return "";
    try {
      const date = new Date(isoString);
      // Return YYYY-MM-DD
      return date.toISOString().split("T")[0];
    } catch {
      return isoString;
    }
  }

  async updateVisualDisplay(
    cardQueue: VisualQueueMember[],
    accessoryQueue: VisualQueueMember[]
  ): Promise<void> {
    await this.ensureSheetIds();
    const visualSheetId = this.sheetIds.get(SHEETS.visualDisplay);
    if (visualSheetId === undefined) throw new Error("Visual display sheet missing");

    const visualSheet = SHEETS.visualDisplay;

    // 1. Clear existing data and formatting in player name cells (B3:B100 and G3:G100)
    // and clear text in all display columns
    await this.sheets.spreadsheets.batchUpdate({
      spreadsheetId: this.spreadsheetId,
      requestBody: {
        requests: [
          // Clear text values
          {
            updateCells: {
              range: {
                sheetId: visualSheetId,
                startRowIndex: 2,
                endRowIndex: 100,
                startColumnIndex: 0,
                endColumnIndex: 4,
              },
              fields: "userEnteredValue",
            },
          },
          {
            updateCells: {
              range: {
                sheetId: visualSheetId,
                startRowIndex: 2,
                endRowIndex: 100,
                startColumnIndex: 5,
                endColumnIndex: 9,
              },
              fields: "userEnteredValue",
            },
          },
          // Clear background color in player name columns (B=1, G=6)
          {
            repeatCell: {
              range: {
                sheetId: visualSheetId,
                startRowIndex: 2,
                endRowIndex: 100,
                startColumnIndex: 1,
                endColumnIndex: 2,
              },
              cell: { userEnteredFormat: { backgroundColor: { red: 1, green: 1, blue: 1 } } },
              fields: "userEnteredFormat.backgroundColor",
            },
          },
          {
            repeatCell: {
              range: {
                sheetId: visualSheetId,
                startRowIndex: 2,
                endRowIndex: 100,
                startColumnIndex: 6,
                endColumnIndex: 7,
              },
              cell: { userEnteredFormat: { backgroundColor: { red: 1, green: 1, blue: 1 } } },
              fields: "userEnteredFormat.backgroundColor",
            },
          },
        ],
      },
    });

    const requests: sheets_v4.Schema$Request[] = [];

    // 2. Prepare Card Queue Requests
    if (cardQueue.length > 0) {
      cardQueue.forEach((e, i) => {
        const rowIndex = 2 + i;
        // Text values
        requests.push({
          updateCells: {
            range: {
              sheetId: visualSheetId,
              startRowIndex: rowIndex,
              endRowIndex: rowIndex + 1,
              startColumnIndex: 0,
              endColumnIndex: 4,
            },
            rows: [{
              values: [
                this.stringCell(e.position),
                this.stringCell(e.text),
                this.stringCell(e.className),
                this.stringCell(this.formatDisplayDate(e.queuedAt)),
              ],
            }],
            fields: "userEnteredValue",
          },
        });
        // Background color for name cell (B = column index 1)
        const rgb = e.colorHex ? hexToRgb(e.colorHex) : null;
        if (rgb) {
          requests.push({
            updateCells: {
              range: {
                sheetId: visualSheetId,
                startRowIndex: rowIndex,
                endRowIndex: rowIndex + 1,
                startColumnIndex: 1,
                endColumnIndex: 2,
              },
              rows: [{
                values: [{ userEnteredFormat: { backgroundColor: rgb } }],
              }],
              fields: "userEnteredFormat.backgroundColor",
            },
          });
        }
      });
    } else {
      requests.push({
        updateCells: {
          range: {
            sheetId: visualSheetId,
            startRowIndex: 2,
            endRowIndex: 3,
            startColumnIndex: 0,
            endColumnIndex: 4,
          },
          rows: [{ values: [this.stringCell("ไม่มีคิว"), this.stringCell(""), this.stringCell(""), this.stringCell("")] }],
          fields: "userEnteredValue",
        },
      });
    }

    // 3. Prepare Accessory Queue Requests
    if (accessoryQueue.length > 0) {
      accessoryQueue.forEach((e, i) => {
        const rowIndex = 2 + i;
        // Text values
        requests.push({
          updateCells: {
            range: {
              sheetId: visualSheetId,
              startRowIndex: rowIndex,
              endRowIndex: rowIndex + 1,
              startColumnIndex: 5,
              endColumnIndex: 9,
            },
            rows: [{
              values: [
                this.stringCell(e.position),
                this.stringCell(e.text),
                this.stringCell(e.className),
                this.stringCell(this.formatDisplayDate(e.queuedAt)),
              ],
            }],
            fields: "userEnteredValue",
          },
        });
        // Background color for name cell (G = column index 6)
        const rgb = e.colorHex ? hexToRgb(e.colorHex) : null;
        if (rgb) {
          requests.push({
            updateCells: {
              range: {
                sheetId: visualSheetId,
                startRowIndex: rowIndex,
                endRowIndex: rowIndex + 1,
                startColumnIndex: 6,
                endColumnIndex: 7,
              },
              rows: [{
                values: [{ userEnteredFormat: { backgroundColor: rgb } }],
              }],
              fields: "userEnteredFormat.backgroundColor",
            },
          });
        }
      });
    } else {
      requests.push({
        updateCells: {
          range: {
            sheetId: visualSheetId,
            startRowIndex: 2,
            endRowIndex: 3,
            startColumnIndex: 5,
            endColumnIndex: 9,
          },
          rows: [{ values: [this.stringCell("ไม่มีคิว"), this.stringCell(""), this.stringCell(""), this.stringCell("")] }],
          fields: "userEnteredValue",
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

  async validateReadiness(): Promise<void> {
    await this.ensureSheetIds();
    const required = [SHEETS.queueEntries, SHEETS.queueHistory];
    const missing = required.filter((name) => !this.sheetIds.has(name));
    if (missing.length > 0) {
      throw new Error(`Queue database is not initialized: missing sheet(s) ${missing.join(", ")}`);
    }
  }
}
