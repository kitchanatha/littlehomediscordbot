import type { MemberRepository } from "../repositories/member-repository.js";
import type { SheetDisplayRepository } from "../repositories/display-repository.js";
import type { ClassService } from "./class-service.js";
import type { Member } from "../types/member.js";

// Must match the guild's actual Google Sheet tab names exactly
// (migrated from "Little Home War 2.xlsx").
const PLAYER_FACING_SHEETS = [
  "รายชื่อตี้วอร์ห้องหลัก",
  "รายชื่ออีลิทตีอบอสวันอาทิตย์",
  "ตี้วอร์วันอาทิตย์",
  "เช็คขาด-ลา",
];

const CLASS_TABS = [
  "Knight", "Paladin", "Hunter", "Assassin", "Wizard",
  "Priest", "Monk", "Blacksmith", "Gunslinger", "Druid"
];

// The three player-facing sheets here that aren't handled by a full row-delete elsewhere when a
// member leaves (เช็คขาด-ลา and the CLASS_TABS get their whole row removed by
// AttendanceRepository.deleteMemberAttendance instead, which also clears their date-column
// history — more thorough than just blanking the name cell these two functions touch).
const ROSTER_ONLY_SHEETS = [
  "รายชื่อตี้วอร์ห้องหลัก",
  "รายชื่ออีลิทตีอบอสวันอาทิตย์",
  "ตี้วอร์วันอาทิตย์",
];

export class SheetDisplayService {
  constructor(
    private readonly memberRepository: MemberRepository,
    private readonly displayRepository: SheetDisplayRepository,
    private readonly classService: ClassService
  ) {}

  async refreshAllMemberDisplays(memberId: string): Promise<void> {
    const members = await this.memberRepository.getAllMembers();
    const targetMember = members.find(m => m.memberId === memberId);
    if (!targetMember) return;

    // We search for this member across all relevant sheets.
    // For safety, we search for their current CharacterName and potentially their old ones if we tracked them,
    // but here we'll search by their current character name.
    
    // Actually, it's better to get all active members and refresh everything that matches any active member.
    // But the requirement says "refresh all affected derived player displays".
    
    await this.refreshSheetsForMembers([targetMember]);
  }

  /** Blanks out every cell showing this character's name on the roster sheets not already
   * covered by a full row-delete elsewhere — used when a member leaves and all their data
   * should go. */
  async clearMemberEverywhere(characterName: string): Promise<void> {
    for (const sheetName of ROSTER_ONLY_SHEETS) {
      try {
        const cellLocations = await this.displayRepository.findPlayerCells(sheetName, [characterName]);
        if (cellLocations.length === 0) continue;
        const displaysToUpdate = cellLocations.map((loc) => ({
          range: loc.range,
          display: { text: "", className: "", symbol: "", colorHex: null },
        }));
        await this.displayRepository.refreshPlayerDisplays(sheetName, displaysToUpdate);
      } catch (error) {
        console.error(`ERROR Failed to clear ${characterName} from sheet ${sheetName}`, error);
      }
    }
  }

  async refreshAllDisplays(): Promise<void> {
    const activeMembers = await this.memberRepository.getAllActiveMembers();
    await this.refreshSheetsForMembers(activeMembers);
  }

  private async refreshSheetsForMembers(members: Member[]): Promise<void> {
    const characterNames = members.map(m => m.characterName);
    const memberMap = new Map(members.map(m => [m.characterName, m]));
    
    const allSheets = [...PLAYER_FACING_SHEETS, ...CLASS_TABS];

    for (const sheetName of allSheets) {
      try {
        const cellLocations = await this.displayRepository.findPlayerCells(sheetName, characterNames);
        if (cellLocations.length === 0) continue;

        const displaysToUpdate: { range: string; display: any }[] = [];
        for (const loc of cellLocations) {
          const member = memberMap.get(loc.characterName);
          if (member && member.status === "Active") {
            const display = await this.classService.formatPlayerDisplay(member);
            displaysToUpdate.push({
              range: loc.range,
              display
            });
          } else {
            // Clear if not active or not found
            displaysToUpdate.push({
              range: loc.range,
              display: { text: "", colorHex: null }
            });
          }
        }

        if (displaysToUpdate.length > 0) {
          await this.displayRepository.refreshPlayerDisplays(sheetName, displaysToUpdate);
        }
      } catch (error) {
        console.error(`ERROR Failed to refresh sheet ${sheetName}`, error);
      }
    }
  }
}
