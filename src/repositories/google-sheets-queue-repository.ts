import { sheets_v4 } from "googleapis";
import { env } from "../config/env.js";
import { sheetsClient } from "../google/sheets-client.js";
import { QueueEntry, QueueHistory, QueueType } from "../types/queue.js";
import { hexToRgb } from "../utils/color.js";
import { QueueRepository, VisualQueueMember } from "./queue-repository.js";

const SHEETS = {
  queueEntries: "Queue_Entries",
  queueHistory: "Queue_History",
  // Two separate sheets, matching how the guild actually tracks these (not one combined sheet).
  // คิวการ์ดประดับ is the guild's existing Card queue sheet, kept as-is; คิวประดับ is new for Accessory.
  cardQueueDisplay: "คิวการ์ดประดับ",
  accessoryQueueDisplay: "คิวประดับ",
} as const;

const QUEUE_DISPLAY_MAX_ROWS = 300;

export class GoogleSheetsQueueRepository implements QueueRepository {
  private readonly sheets: sheets_v4.Sheets = sheetsClient;
  private readonly spreadsheetId = env.GOOGLE_SHEET_ID;
  private sheetIds = new Map<string, number>();
  private sheetRowCounts = new Map<string, number>();

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
      if (title && id !== undefined && id !== null) {
        this.sheetIds.set(title, id);
        const rowCount = sheet.properties?.gridProperties?.rowCount;
        if (rowCount) this.sheetRowCounts.set(title, rowCount);
      }
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

  async updateVisualDisplay(
    cardQueue: VisualQueueMember[],
    accessoryQueue: VisualQueueMember[]
  ): Promise<void> {
    await Promise.all([
      this.writeQueueList(SHEETS.cardQueueDisplay, cardQueue),
      this.writeQueueList(SHEETS.accessoryQueueDisplay, accessoryQueue),
    ]);
  }

  // Mirrors the guild's original style for these sheets: one name per row, in queue order,
  // header row left alone. Skips silently if the sheet hasn't been created yet (e.g. the
  // Accessory queue sheet is new and may not exist until an admin adds it).
  private async writeQueueList(sheetName: string, queue: VisualQueueMember[]): Promise<void> {
    await this.ensureSheetIds();
    const sheetId = this.sheetIds.get(sheetName);
    if (sheetId === undefined) return;

    // A GridRange (used below) that extends past the sheet's current row count fails with
    // "exceeds grid limits", so grow the sheet first whenever it's smaller than what we need.
    // 1000 is Google Sheets' standard default row count for a new sheet, used only if the
    // row count somehow wasn't available from the earlier sheet-metadata fetch.
    const currentRowCount = this.sheetRowCounts.get(sheetName) ?? 1000;
    const targetRowCount = Math.max(queue.length + 1, Math.min(QUEUE_DISPLAY_MAX_ROWS, currentRowCount));
    if (targetRowCount > currentRowCount) {
      await this.sheets.spreadsheets.batchUpdate({
        spreadsheetId: this.spreadsheetId,
        requestBody: {
          requests: [{
            appendDimension: { sheetId, dimension: "ROWS", length: targetRowCount - currentRowCount },
          }],
        },
      });
      this.sheetRowCounts.set(sheetName, targetRowCount);
    }

    const clearEndRow = Math.min(QUEUE_DISPLAY_MAX_ROWS, this.sheetRowCounts.get(sheetName)!);

    const requests: sheets_v4.Schema$Request[] = [
      {
        // Clear both value AND background color — otherwise a class color from a previous,
        // longer queue lingers on rows the current (shorter) queue no longer uses.
        updateCells: {
          range: { sheetId, startRowIndex: 1, endRowIndex: clearEndRow, startColumnIndex: 0, endColumnIndex: 1 },
          fields: "userEnteredValue,userEnteredFormat.backgroundColor",
        },
      },
      // Header row: bold text on a light gray background, frozen so it stays visible on scroll.
      {
        repeatCell: {
          range: { sheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: 1 },
          cell: {
            userEnteredFormat: {
              backgroundColor: { red: 0.85, green: 0.85, blue: 0.85 },
              textFormat: { bold: true, fontSize: 11 },
              horizontalAlignment: "CENTER",
            },
          },
          fields: "userEnteredFormat(backgroundColor,textFormat,horizontalAlignment)",
        },
      },
      {
        updateSheetProperties: {
          properties: { sheetId, gridProperties: { frozenRowCount: 1 } },
          fields: "gridProperties.frozenRowCount",
        },
      },
      // Wide enough for a class symbol + a longer character name without truncating.
      {
        updateDimensionProperties: {
          range: { sheetId, dimension: "COLUMNS", startIndex: 0, endIndex: 1 },
          properties: { pixelSize: 220 },
          fields: "pixelSize",
        },
      },
    ];

    queue.forEach((entry, i) => {
      const rowIndex = 1 + i;
      const color = entry.colorHex ? hexToRgb(entry.colorHex) : null;
      requests.push({
        updateCells: {
          range: { sheetId, startRowIndex: rowIndex, endRowIndex: rowIndex + 1, startColumnIndex: 0, endColumnIndex: 1 },
          rows: [{
            values: [{
              ...this.stringCell(entry.text),
              ...(color ? { userEnteredFormat: { backgroundColor: color } } : {}),
            }],
          }],
          fields: color ? "userEnteredValue,userEnteredFormat.backgroundColor" : "userEnteredValue",
        },
      });
    });

    await this.sheets.spreadsheets.batchUpdate({
      spreadsheetId: this.spreadsheetId,
      requestBody: { requests },
    });
  }

  async validateReadiness(): Promise<void> {
    await this.ensureSheetIds();
    // Accessory queue display sheet is intentionally optional (see writeQueueList above).
    const required = [SHEETS.queueEntries, SHEETS.queueHistory, SHEETS.cardQueueDisplay];
    const missing = required.filter((name) => !this.sheetIds.has(name));
    if (missing.length > 0) {
      throw new Error(`Queue database is not initialized: missing sheet(s) ${missing.join(", ")}`);
    }
  }
}
