import { sheets_v4 } from "googleapis";
import { env } from "../config/env.js";
import { sheetsClient } from "../google/sheets-client.js";
import type { HistoryEntry, LegacyMember, Member } from "../types/member.js";
import type { ClassConfig } from "../types/class.js";
import { normalizeName } from "../utils/normalize.js";
import { hexToRgb } from "../utils/color.js";
import type { MemberRepository } from "./member-repository.js";

const SHEETS = {
  members: "Members",
  nameHistory: "Name_History",
  classHistory: "Class_History",
  teamHistory: "Team_History",
  partyHistory: "Party_History",
  classes: "Classes",
  legacy: "Legacy_Members",
  auditLog: "Audit_Log",
} as const;

// Transcribed in-game roster data (see src/scripts/update-combat-power.ts). Deliberately NOT
// part of SHEETS above: that list is required at startup (validateReadiness), and this sheet
// is a nice-to-have data source, not core to the bot working — its absence should degrade
// gracefully, not take the whole bot down.
const GAME_ROSTER_SHEET = "Members";
// Plain two-column (CharacterName, War Check-in) display tab kept in sync alongside Members.
const DISPLAY_SHEET = "Little Home member";
const MEMBERS_COMBAT_POWER_COL = "K";
const MEMBERS_COMBAT_POWER_COL_INDEX0 = 10; // K is the 11th column, 0-indexed 10

export class GoogleSheetsMemberRepository implements MemberRepository {
  private readonly sheets: sheets_v4.Sheets = sheetsClient;
  private readonly spreadsheetId = env.GOOGLE_SHEET_ID;
  private sheetIds = new Map<string, number>();
  private sheetColumnCounts = new Map<string, number>();

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
        const columnCount = sheet.properties?.gridProperties?.columnCount;
        if (columnCount) this.sheetColumnCounts.set(title, columnCount);
      }
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
    const rows = await this.values(`${SHEETS.legacy}!A2:J`);

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
      linkedMemberId: row[7] ?? undefined,
      linkedDiscordId: row[8] ?? undefined,
      linkedAt: row[9] ?? undefined,
    };
  }

  async getActiveClasses(): Promise<string[]> {
    const configs = await this.getClassConfigs();
    return configs.filter((c) => c.active).map((c) => c.className);
  }

  async getClassConfigs(): Promise<ClassConfig[]> {
    const rows = await this.values(`${SHEETS.classes}!A2:F`);
    return rows.map((r) => ({
      classId: r[0] ?? "",
      className: r[1] ?? "",
      active: ["TRUE", "true", "1"].includes(String(r[2] ?? "")),
      sortOrder: Number(r[3] ?? 9999),
      symbol: r[4] ?? "",
      colorHex: r[5] ?? "",
    })).sort((a, b) => a.sortOrder - b.sortOrder);
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
    await this.applyCharacterNameColor(member.discordId, member.className);
    await this.addToDisplaySheet(member.characterName, member.className);
  }

  // "Little Home member" is a plain two-column (CharacterName, War Check-in) display tab kept
  // alongside the full Members tab for a quick glance — best-effort, never allowed to fail
  // registration/rename if the Sheets API hiccups. Colored the same way as the Members tab.
  private async addToDisplaySheet(characterName: string, className: string): Promise<void> {
    try {
      const rows = await this.values(`${DISPLAY_SHEET}!A2:A`);
      const exists = rows.some((r) => normalizeName(r[0] ?? "") === normalizeName(characterName));
      if (!exists) {
        await this.sheets.spreadsheets.values.append({
          spreadsheetId: this.spreadsheetId,
          range: `${DISPLAY_SHEET}!A:B`,
          valueInputOption: "RAW",
          insertDataOption: "INSERT_ROWS",
          requestBody: { values: [[characterName, ""]] },
        });
      }
      await this.colorDisplaySheetRow(characterName, className);
    } catch (err) {
      console.error(`WARN Failed to add "${characterName}" to "${DISPLAY_SHEET}" tab`, err);
    }
  }

  private async renameInDisplaySheet(oldName: string, newName: string): Promise<void> {
    try {
      const rows = await this.values(`${DISPLAY_SHEET}!A2:A`);
      const idx = rows.findIndex((r) => normalizeName(r[0] ?? "") === normalizeName(oldName));
      if (idx < 0) return;
      await this.sheets.spreadsheets.values.update({
        spreadsheetId: this.spreadsheetId,
        range: `${DISPLAY_SHEET}!A${idx + 2}`,
        valueInputOption: "RAW",
        requestBody: { values: [[newName]] },
      });
    } catch (err) {
      console.error(`WARN Failed to rename "${oldName}" -> "${newName}" on "${DISPLAY_SHEET}" tab`, err);
    }
  }

  private async colorDisplaySheetRow(characterName: string, className: string): Promise<void> {
    const color = await this.classColorRgb(className);
    if (!color) return;
    try {
      await this.ensureSheetIds();
      const sheetId = this.sheetIds.get(DISPLAY_SHEET);
      if (sheetId === undefined) return;
      const rows = await this.values(`${DISPLAY_SHEET}!A2:A`);
      const idx = rows.findIndex((r) => normalizeName(r[0] ?? "") === normalizeName(characterName));
      if (idx < 0) return;
      await this.sheets.spreadsheets.batchUpdate({
        spreadsheetId: this.spreadsheetId,
        requestBody: {
          requests: [{
            repeatCell: {
              range: { sheetId, startRowIndex: idx + 1, endRowIndex: idx + 2, startColumnIndex: 0, endColumnIndex: 2 },
              cell: { userEnteredFormat: { backgroundColor: color } },
              fields: "userEnteredFormat.backgroundColor",
            },
          }],
        },
      });
    } catch (err) {
      console.error(`WARN Failed to color "${characterName}" on "${DISPLAY_SHEET}" tab`, err);
    }
  }

  // Colors the whole member row (A:J) by class, matching the color scheme already used
  // elsewhere (Classes!ColorHex) — so the live Members tab visually groups by class at a glance,
  // same as the class attendance tabs already do.
  private async classColorRgb(className: string): Promise<sheets_v4.Schema$Color | null> {
    if (!className) return null;
    const configs = await this.getClassConfigs();
    const config = configs.find((c) => c.className === className);
    return config?.colorHex ? hexToRgb(config.colorHex) : null;
  }

  private async applyCharacterNameColor(discordId: string, className: string): Promise<void> {
    const color = await this.classColorRgb(className);
    if (!color) return;
    await this.ensureSheetIds();
    const membersSheetId = this.sheetIds.get(SHEETS.members);
    if (membersSheetId === undefined) return;

    let rowIndex: number;
    try {
      rowIndex = await this.findMemberRow(discordId);
    } catch {
      return; // row not found yet — nothing to color
    }

    await this.sheets.spreadsheets.batchUpdate({
      spreadsheetId: this.spreadsheetId,
      requestBody: {
        requests: [{
          repeatCell: {
            range: { sheetId: membersSheetId, startRowIndex: rowIndex, endRowIndex: rowIndex + 1, startColumnIndex: 0, endColumnIndex: 10 },
            cell: { userEnteredFormat: { backgroundColor: color } },
            fields: "userEnteredFormat.backgroundColor",
          },
        }],
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
    await this.renameInDisplaySheet(member.characterName, newName);
    return { ...member, characterName: newName, lastUpdated: history.changedAt };
  }

  async updateClass(member: Member, newClass: string, history: HistoryEntry): Promise<Member> {
    await this.atomicMemberChange(member, 4, newClass, SHEETS.classHistory, history);
    await this.applyCharacterNameColor(member.discordId, newClass);
    await this.colorDisplaySheetRow(member.characterName, newClass);
    return { ...member, className: newClass, lastUpdated: history.changedAt };
  }

  async updateTeamAndParty(member: Member, updates: { team?: string; party?: string }, histories: HistoryEntry[], audit: any): Promise<Member> {
    await this.ensureSheetIds();
    const membersSheetId = this.sheetIds.get(SHEETS.members);
    const auditSheetId = this.sheetIds.get(SHEETS.auditLog);
    if (membersSheetId === undefined || auditSheetId === undefined) throw new Error("Required sheet missing");

    const rowIndex = await this.findMemberRow(member.discordId);
    const requests: sheets_v4.Schema$Request[] = [];

    if (updates.team) {
      requests.push({
        updateCells: {
          range: {
            sheetId: membersSheetId,
            startRowIndex: rowIndex,
            endRowIndex: rowIndex + 1,
            startColumnIndex: 5,
            endColumnIndex: 6,
          },
          rows: [{ values: [this.stringCell(updates.team)] }],
          fields: "userEnteredValue",
        },
      });
    }

    if (updates.party) {
      requests.push({
        updateCells: {
          range: {
            sheetId: membersSheetId,
            startRowIndex: rowIndex,
            endRowIndex: rowIndex + 1,
            startColumnIndex: 6,
            endColumnIndex: 7,
          },
          rows: [{ values: [this.stringCell(updates.party)] }],
          fields: "userEnteredValue",
        },
      });
    }

    // Update LastUpdated
    const now = histories[0]?.changedAt || new Date().toISOString();
    requests.push({
      updateCells: {
        range: {
          sheetId: membersSheetId,
          startRowIndex: rowIndex,
          endRowIndex: rowIndex + 1,
          startColumnIndex: 9,
          endColumnIndex: 10,
        },
        rows: [{ values: [this.stringCell(now)] }],
        fields: "userEnteredValue",
      },
    });

    // History appends
    for (const h of histories) {
      const hSheet = h.type === "team" ? SHEETS.teamHistory : SHEETS.partyHistory;
      const hSheetId = this.sheetIds.get(hSheet);
      if (hSheetId === undefined) throw new Error(`History sheet ${hSheet} missing`);
      
      requests.push({
        appendCells: {
          sheetId: hSheetId,
          rows: [{
            values: [
              this.stringCell(h.historyId),
              this.stringCell(h.memberId),
              this.stringCell(h.discordId),
              this.stringCell(h.oldValue),
              this.stringCell(h.newValue),
              this.stringCell(h.changedAt),
              this.stringCell(h.changedBy),
            ],
          }],
          fields: "userEnteredValue",
        },
      });
    }

    // Audit Log append
    // Schema: Action, TargetMemberID, TargetDiscordID, AdminDiscordID, OldTeam, NewTeam, OldParty, NewParty, Timestamp
    requests.push({
      appendCells: {
        sheetId: auditSheetId,
        rows: [{
          values: [
            this.stringCell(audit.action),
            this.stringCell(audit.targetMemberId),
            this.stringCell(audit.targetDiscordId),
            this.stringCell(audit.adminDiscordId),
            this.stringCell(audit.oldTeam),
            this.stringCell(audit.newTeam),
            this.stringCell(audit.oldParty),
            this.stringCell(audit.newParty),
            this.stringCell(audit.timestamp),
          ],
        }],
        fields: "userEnteredValue",
      },
    });

    await this.sheets.spreadsheets.batchUpdate({
      spreadsheetId: this.spreadsheetId,
      requestBody: { requests },
    });

    return {
      ...member,
      team: updates.team ?? member.team,
      party: updates.party ?? member.party,
      lastUpdated: now,
    };
  }

  async updateNameAndClass(
    member: Member,
    updates: { name?: string; className?: string },
    histories: HistoryEntry[],
    audit: any
  ): Promise<Member> {
    await this.ensureSheetIds();
    const membersSheetId = this.sheetIds.get(SHEETS.members);
    const auditSheetId = this.sheetIds.get(SHEETS.auditLog);
    if (membersSheetId === undefined || auditSheetId === undefined) throw new Error("Required sheet missing");

    const rowIndex = await this.findMemberRow(member.discordId);
    const requests: sheets_v4.Schema$Request[] = [];

    if (updates.name) {
      requests.push({
        updateCells: {
          range: {
            sheetId: membersSheetId,
            startRowIndex: rowIndex,
            endRowIndex: rowIndex + 1,
            startColumnIndex: 3,
            endColumnIndex: 4,
          },
          rows: [{ values: [this.stringCell(updates.name)] }],
          fields: "userEnteredValue",
        },
      });
    }

    if (updates.className) {
      requests.push({
        updateCells: {
          range: {
            sheetId: membersSheetId,
            startRowIndex: rowIndex,
            endRowIndex: rowIndex + 1,
            startColumnIndex: 4,
            endColumnIndex: 5,
          },
          rows: [{ values: [this.stringCell(updates.className)] }],
          fields: "userEnteredValue",
        },
      });
    }

    // Update LastUpdated
    const now = histories[0]?.changedAt || new Date().toISOString();
    requests.push({
      updateCells: {
        range: {
          sheetId: membersSheetId,
          startRowIndex: rowIndex,
          endRowIndex: rowIndex + 1,
          startColumnIndex: 9,
          endColumnIndex: 10,
        },
        rows: [{ values: [this.stringCell(now)] }],
        fields: "userEnteredValue",
      },
    });

    // History appends
    for (const h of histories) {
      const hSheet = h.type === "name" ? SHEETS.nameHistory : SHEETS.classHistory;
      const hSheetId = this.sheetIds.get(hSheet);
      if (hSheetId === undefined) throw new Error(`History sheet ${hSheet} missing`);
      
      requests.push({
        appendCells: {
          sheetId: hSheetId,
          rows: [{
            values: [
              this.stringCell(h.historyId),
              this.stringCell(h.memberId),
              this.stringCell(h.discordId),
              this.stringCell(h.oldValue),
              this.stringCell(h.newValue),
              this.stringCell(h.changedAt),
              this.stringCell(h.changedBy),
            ],
          }],
          fields: "userEnteredValue",
        },
      });
    }

    // Audit Log append
    // Schema: Action, TargetMemberID, TargetDiscordID, AdminDiscordID, OldValue1, NewValue1, OldValue2, NewValue2, Timestamp
    requests.push({
      appendCells: {
        sheetId: auditSheetId,
        rows: [{
          values: [
            this.stringCell(audit.action),
            this.stringCell(audit.targetMemberId),
            this.stringCell(audit.targetDiscordId),
            this.stringCell(audit.adminDiscordId),
            this.stringCell(audit.oldValue1 || ""),
            this.stringCell(audit.newValue1 || ""),
            this.stringCell(audit.oldValue2 || ""),
            this.stringCell(audit.newValue2 || ""),
            this.stringCell(audit.timestamp),
          ],
        }],
        fields: "userEnteredValue",
      },
    });

    await this.sheets.spreadsheets.batchUpdate({
      spreadsheetId: this.spreadsheetId,
      requestBody: { requests },
    });

    return {
      ...member,
      characterName: updates.name ?? member.characterName,
      className: updates.className ?? member.className,
      lastUpdated: now,
    };
  }

  async getHistory(memberId: string): Promise<HistoryEntry[]> {
    const [names, classes, teams, parties] = await Promise.all([
      this.values(`${SHEETS.nameHistory}!A2:G`),
      this.values(`${SHEETS.classHistory}!A2:G`),
      this.values(`${SHEETS.teamHistory}!A2:G`),
      this.values(`${SHEETS.partyHistory}!A2:G`),
    ]);

    const mapRow = (r: string[], type: HistoryEntry["type"]): HistoryEntry => ({
      type,
      historyId: r[0] ?? "",
      memberId: r[1] ?? "",
      discordId: r[2] ?? "",
      oldValue: r[3] ?? "",
      newValue: r[4] ?? "",
      changedAt: r[5] ?? "",
      changedBy: r[6] ?? "",
    });

    const histories: HistoryEntry[] = [
      ...names.filter(r => r[1] === memberId).map(r => mapRow(r, "name")),
      ...classes.filter(r => r[1] === memberId).map(r => mapRow(r, "class")),
      ...teams.filter(r => r[1] === memberId).map(r => mapRow(r, "team")),
      ...parties.filter(r => r[1] === memberId).map(r => mapRow(r, "party")),
    ];

    return histories.sort((a, b) => b.changedAt.localeCompare(a.changedAt));
  }

  async getAllMemberIds(): Promise<string[]> {
    const rows = await this.values(`${SHEETS.members}!A2:A`);
    return rows.map((r) => r[0]).filter(Boolean);
  }

  async getAllHistoryIds(): Promise<string[]> {
    const [names, classes, teams, parties] = await Promise.all([
      this.values(`${SHEETS.nameHistory}!A2:A`),
      this.values(`${SHEETS.classHistory}!A2:A`),
      this.values(`${SHEETS.teamHistory}!A2:A`),
      this.values(`${SHEETS.partyHistory}!A2:A`),
    ]);
    return [
      ...names.map((r) => r[0]),
      ...classes.map((r) => r[0]),
      ...teams.map((r) => r[0]),
      ...parties.map((r) => r[0]),
    ].filter(Boolean);
  }

  async linkLegacy(legacyName: string, discordId: string, memberId: string, linkedAt: string): Promise<void> {
    await this.ensureSheetIds();
    const legacySheetId = this.sheetIds.get(SHEETS.legacy);
    if (legacySheetId === undefined) throw new Error("Legacy sheet missing");

    const rows = await this.values(`${SHEETS.legacy}!A2:A`);
    const rowIndex = rows.findIndex((r) => normalizeName(r[0] ?? "") === normalizeName(legacyName));
    if (rowIndex < 0) throw new Error("Legacy member not found during linking");

    const sheetRow = rowIndex + 1; // row 1 is header, A2 is index 0

    await this.sheets.spreadsheets.batchUpdate({
      spreadsheetId: this.spreadsheetId,
      requestBody: {
        requests: [
          {
            updateCells: {
              range: {
                sheetId: legacySheetId,
                startRowIndex: sheetRow,
                endRowIndex: sheetRow + 1,
                startColumnIndex: 7,
                endColumnIndex: 10,
              },
              rows: [{
                values: [
                  this.stringCell(memberId),
                  this.stringCell(discordId),
                  this.stringCell(linkedAt),
                ],
              }],
              fields: "userEnteredValue",
            },
          },
        ],
      },
    });
  }

  async getAllActiveMembers(): Promise<Member[]> {
    const rows = await this.values(`${SHEETS.members}!A2:J`);
    return rows.map((row) => this.memberFromRow(row)).filter((m) => m.status.toLowerCase() === "active");
  }

  async getAllDiscordIds(): Promise<string[]> {
    const rows = await this.values(`${SHEETS.members}!B2:B`);
    return rows.map((r) => r[0]);
  }

  async createMembersBulk(members: Member[]): Promise<void> {
    if (members.length === 0) return;
    await this.ensureSheetIds();
    const sheetId = this.sheetIds.get(SHEETS.members);
    if (sheetId === undefined) throw new Error("Members sheet missing");

    const requests: sheets_v4.Schema$Request[] = [
      {
        appendCells: {
          sheetId,
          rows: members.map((m) => ({
            values: [
              this.stringCell(m.memberId),
              this.stringCell(m.discordId),
              this.stringCell(m.discordUsername),
              this.stringCell(m.characterName),
              this.stringCell(m.className),
              this.stringCell(m.team),
              this.stringCell(m.party),
              this.stringCell(m.status),
              this.stringCell(m.joinedDate),
              this.stringCell(m.lastUpdated),
            ],
          })),
          fields: "userEnteredValue",
        },
      },
    ];

    await this.sheets.spreadsheets.batchUpdate({
      spreadsheetId: this.spreadsheetId,
      requestBody: { requests },
    });
  }

  async updateMemberStatus(
    member: Member,
    status: string,
    lastUpdated: string,
    audit: any,
    newUsername?: string
  ): Promise<void> {
    await this.ensureSheetIds();
    const membersSheetId = this.sheetIds.get(SHEETS.members);
    const auditSheetId = this.sheetIds.get(SHEETS.auditLog);
    if (membersSheetId === undefined || auditSheetId === undefined) throw new Error("Required sheet missing");

    const rowIndex = await this.findMemberRow(member.discordId);
    const requests: sheets_v4.Schema$Request[] = [];

    // Update Status
    requests.push({
      updateCells: {
        range: {
          sheetId: membersSheetId,
          startRowIndex: rowIndex,
          endRowIndex: rowIndex + 1,
          startColumnIndex: 7,
          endColumnIndex: 8,
        },
        rows: [{ values: [this.stringCell(status)] }],
        fields: "userEnteredValue",
      },
    });

    if (newUsername) {
      // Update DiscordUsername
      requests.push({
        updateCells: {
          range: {
            sheetId: membersSheetId,
            startRowIndex: rowIndex,
            endRowIndex: rowIndex + 1,
            startColumnIndex: 2,
            endColumnIndex: 3,
          },
          rows: [{ values: [this.stringCell(newUsername)] }],
          fields: "userEnteredValue",
        },
      });
    }

    // Update LastUpdated
    requests.push({
      updateCells: {
        range: {
          sheetId: membersSheetId,
          startRowIndex: rowIndex,
          endRowIndex: rowIndex + 1,
          startColumnIndex: 9,
          endColumnIndex: 10,
        },
        rows: [{ values: [this.stringCell(lastUpdated)] }],
        fields: "userEnteredValue",
      },
    });

    // Audit Log append
    requests.push({
      appendCells: {
        sheetId: auditSheetId,
        rows: [{
          values: [
            this.stringCell(audit.action),
            this.stringCell(audit.targetMemberId),
            this.stringCell(audit.targetDiscordId),
            this.stringCell(audit.adminDiscordId),
            this.stringCell(audit.oldValue1 || ""),
            this.stringCell(audit.newValue1 || ""),
            this.stringCell(audit.oldValue2 || ""),
            this.stringCell(audit.newValue2 || ""),
            this.stringCell(audit.timestamp),
          ],
        }],
        fields: "userEnteredValue",
      },
    });

    await this.sheets.spreadsheets.batchUpdate({
      spreadsheetId: this.spreadsheetId,
      requestBody: { requests },
    });
  }

  async getAllMembers(): Promise<Member[]> {
    const rows = await this.values(`${SHEETS.members}!A2:J`);
    return rows.map((row) => this.memberFromRow(row));
  }

  async validateReadiness(): Promise<void> {
    await this.ensureSheetIds();
    const required = Object.values(SHEETS);
    const missing = required.filter((name) => !this.sheetIds.has(name));
    if (missing.length > 0) {
      throw new Error(`Member database is not initialized: missing sheet(s) ${missing.join(", ")}`);
    }
  }

  async findGameRosterCombatPower(characterName: string): Promise<string | null> {
    if (!env.GAME_ROSTER_SHEET_ID) return null; // not configured — nothing to carry over
    let rows: string[][];
    try {
      const response = await this.sheets.spreadsheets.values.get({
        spreadsheetId: env.GAME_ROSTER_SHEET_ID,
        // Columns on the roster's "Members" tab: A=CharacterName, B=War Check-in, C=CombatPower.
        range: `${GAME_ROSTER_SHEET}!A2:C`,
      });
      rows = (response.data.values ?? []) as string[][];
    } catch {
      return null; // sheet doesn't exist yet — not fatal, just nothing to carry over
    }
    const target = normalizeName(characterName);
    const match = rows.find((r) => normalizeName(r[0] ?? "") === target);
    return match?.[2] ?? null;
  }

  async setCombatPower(memberId: string, combatPower: string): Promise<void> {
    await this.ensureSheetIds();
    const membersSheetId = this.sheetIds.get(SHEETS.members);
    if (membersSheetId === undefined) throw new Error(`Sheet "${SHEETS.members}" not found`);

    const currentColumnCount = this.sheetColumnCounts.get(SHEETS.members) ?? 0;
    if (currentColumnCount <= MEMBERS_COMBAT_POWER_COL_INDEX0) {
      await this.sheets.spreadsheets.batchUpdate({
        spreadsheetId: this.spreadsheetId,
        requestBody: {
          requests: [{
            appendDimension: {
              sheetId: membersSheetId,
              dimension: "COLUMNS",
              length: MEMBERS_COMBAT_POWER_COL_INDEX0 + 1 - currentColumnCount,
            },
          }],
        },
      });
      this.sheetColumnCounts.set(SHEETS.members, MEMBERS_COMBAT_POWER_COL_INDEX0 + 1);
    }

    const rows = await this.values(`${SHEETS.members}!A2:A`);
    const index = rows.findIndex((r) => r[0] === memberId);
    if (index < 0) throw new Error(`Member "${memberId}" not found`);
    const rowNumber = index + 2; // header row + 0-index

    await this.sheets.spreadsheets.values.update({
      spreadsheetId: this.spreadsheetId,
      range: `${SHEETS.members}!${MEMBERS_COMBAT_POWER_COL}${rowNumber}`,
      valueInputOption: "RAW",
      requestBody: { values: [[combatPower]] },
    });
  }
}
