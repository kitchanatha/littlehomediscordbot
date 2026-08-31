import { google, sheets_v4 } from "googleapis";
import { env } from "../config/env.js";
import type { HistoryEntry, LegacyMember, Member } from "../types/member.js";
import { normalizeName } from "../utils/normalize.js";
import type { MemberRepository } from "./member-repository.js";

const SHEETS = {
  members: "Members",
  nameHistory: "Name_History",
  classHistory: "Class_History",
  classes: "Classes",
  legacy: "Legacy_Members",
} as const;

export class GoogleSheetsMemberRepository implements MemberRepository {
  private readonly sheets: sheets_v4.Sheets;
  private readonly spreadsheetId = env.GOOGLE_SHEET_ID;
  private sheetIds = new Map<string, number>();

  constructor() {
    const auth = new google.auth.JWT({
      email: env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
      key: env.GOOGLE_PRIVATE_KEY,
      scopes: ["https://www.googleapis.com/auth/spreadsheets"],
    });
    this.sheets = google.sheets({ version: "v4", auth });
  }

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

  private stringCell(value: string): sheets_v4.Schema$CellData {
    return { userEnteredValue: { stringValue: value } };
  }

  private memberFromRow(row: string[]): Member {
    return {
      memberId: row[0] ?? "",
      discordId: row[1] ?? "",
      discordUsername: row[2] ?? "",
      characterName: row[3] ?? "",
      className: row[4] ?? "",
      team: row[5] ?? "",
      party: row[6] ?? "",
      status: row[7] ?? "",
      joinedDate: row[8] ?? "",
      lastUpdated: row[9] ?? "",
    };
  }

  async findByDiscordId(discordId: string): Promise<Member | null> {
    const rows = await this.values(`${SHEETS.members}!A2:J`);
    const row = rows.find((r) => r[1] === discordId);
    return row ? this.memberFromRow(row) : null;
  }

  async findLegacyByName(characterName: string): Promise<LegacyMember | null> {
    const target = normalizeName(characterName);
    const rows = await this.values(`${SHEETS.legacy}!A2:G`);

    const exact = rows.find((r) => normalizeName(r[0] ?? "") === target);
    if (!exact) return null;

    if ((exact[5] ?? "").toLowerCase() === "alias") {
      const aliasMatch = /Alias of\s+(.+)/i.exec(exact[6] ?? "");
      if (aliasMatch) {
        const canonical = normalizeName(aliasMatch[1]);
        const canonicalRow = rows.find((r) => normalizeName(r[0] ?? "") === canonical);
        if (canonicalRow) return this.legacyFromRow(canonicalRow);
      }
    }

    return this.legacyFromRow(exact);
  }

  private legacyFromRow(row: string[]): LegacyMember {
    return {
      legacyName: row[0] ?? "",
      className: row[1] ?? "",
      team: row[2] ?? "",
      party: row[3] ?? "",
      source: row[4] ?? "",
      matchStatus: row[5] ?? "",
      notes: row[6] ?? "",
    };
  }

  async getActiveClasses(): Promise<string[]> {
    const rows = await this.values(`${SHEETS.classes}!A2:D`);
    return rows
      .filter((r) => ["TRUE", "true", "1"].includes(String(r[2] ?? "")))
      .sort((a, b) => Number(a[3] ?? 9999) - Number(b[3] ?? 9999))
      .map((r) => r[1])
      .filter(Boolean);
  }

  async createMember(member: Member): Promise<void> {
    await this.sheets.spreadsheets.values.append({
      spreadsheetId: this.spreadsheetId,
      range: `${SHEETS.members}!A:J`,
      valueInputOption: "RAW",
      insertDataOption: "INSERT_ROWS",
      requestBody: {
        values: [[
          member.memberId,
          member.discordId,
          member.discordUsername,
          member.characterName,
          member.className,
          member.team,
          member.party,
          member.status,
          member.joinedDate,
          member.lastUpdated,
        ]],
      },
    });
  }

  private async findMemberRow(discordId: string): Promise<number> {
    const rows = await this.values(`${SHEETS.members}!A2:J`);
    const index = rows.findIndex((r) => r[1] === discordId);
    if (index < 0) throw new Error("Member row not found");
    return index + 1; // zero-based API row index; row 2 => index 1
  }

  private async atomicMemberChange(
    member: Member,
    columnIndex: number,
    newValue: string,
    historySheet: string,
    history: HistoryEntry,
  ): Promise<void> {
    await this.ensureSheetIds();
    const membersSheetId = this.sheetIds.get(SHEETS.members);
    const historySheetId = this.sheetIds.get(historySheet);
    if (membersSheetId === undefined || historySheetId === undefined) throw new Error("Required sheet missing");

    const rowIndex = await this.findMemberRow(member.discordId);
    const historyValues = history.type === "name"
      ? [history.historyId, history.memberId, history.discordId, history.oldValue, history.newValue, history.changedAt, history.changedBy]
      : [history.historyId, history.memberId, history.discordId, history.oldValue, history.newValue, history.changedAt, history.changedBy];

    await this.sheets.spreadsheets.batchUpdate({
      spreadsheetId: this.spreadsheetId,
      requestBody: {
        requests: [
          {
            updateCells: {
              range: {
                sheetId: membersSheetId,
                startRowIndex: rowIndex,
                endRowIndex: rowIndex + 1,
                startColumnIndex: columnIndex,
                endColumnIndex: columnIndex + 1,
              },
              rows: [{ values: [this.stringCell(newValue)] }],
              fields: "userEnteredValue",
            },
          },
          {
            updateCells: {
              range: {
                sheetId: membersSheetId,
                startRowIndex: rowIndex,
                endRowIndex: rowIndex + 1,
                startColumnIndex: 9,
                endColumnIndex: 10,
              },
              rows: [{ values: [this.stringCell(history.changedAt)] }],
              fields: "userEnteredValue",
            },
          },
          {
            appendCells: {
              sheetId: historySheetId,
              rows: [{ values: historyValues.map((v) => this.stringCell(v)) }],
              fields: "userEnteredValue",
            },
          },
        ],
      },
    });
  }

  async updateName(member: Member, newName: string, history: HistoryEntry): Promise<Member> {
    await this.atomicMemberChange(member, 3, newName, SHEETS.nameHistory, history);
    return { ...member, characterName: newName, lastUpdated: history.changedAt };
  }

  async updateClass(member: Member, newClass: string, history: HistoryEntry): Promise<Member> {
    await this.atomicMemberChange(member, 4, newClass, SHEETS.classHistory, history);
    return { ...member, className: newClass, lastUpdated: history.changedAt };
  }

  async getHistory(memberId: string): Promise<HistoryEntry[]> {
    const [names, classes] = await Promise.all([
      this.values(`${SHEETS.nameHistory}!A2:G`),
      this.values(`${SHEETS.classHistory}!A2:G`),
    ]);

    const nameHistory: HistoryEntry[] = names
      .filter((r) => r[1] === memberId)
      .map((r) => ({ type: "name", historyId: r[0] ?? "", memberId: r[1] ?? "", discordId: r[2] ?? "", oldValue: r[3] ?? "", newValue: r[4] ?? "", changedAt: r[5] ?? "", changedBy: r[6] ?? "" }));

    const classHistory: HistoryEntry[] = classes
      .filter((r) => r[1] === memberId)
      .map((r) => ({ type: "class", historyId: r[0] ?? "", memberId: r[1] ?? "", discordId: r[2] ?? "", oldValue: r[3] ?? "", newValue: r[4] ?? "", changedAt: r[5] ?? "", changedBy: r[6] ?? "" }));

    return [...nameHistory, ...classHistory].sort((a, b) => b.changedAt.localeCompare(a.changedAt));
  }

  async getAllMemberIds(): Promise<string[]> {
    const rows = await this.values(`${SHEETS.members}!A2:A`);
    return rows.map((r) => r[0]).filter(Boolean);
  }

  async getAllHistoryIds(): Promise<string[]> {
    const [names, classes] = await Promise.all([
      this.values(`${SHEETS.nameHistory}!A2:A`),
      this.values(`${SHEETS.classHistory}!A2:A`),
    ]);
    return [...names.map((r) => r[0]), ...classes.map((r) => r[0])].filter(Boolean);
  }
}
