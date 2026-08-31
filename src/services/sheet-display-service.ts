import type { MemberRepository } from "../repositories/member-repository.js";
import type { SheetDisplayRepository } from "../repositories/display-repository.js";
import type { ClassService } from "./class-service.js";
import type { Member } from "../types/member.js";

const PLAYER_FACING_SHEETS = [
  "War_Roster_Template",
  "รายชื่อห้องวอห้องหลัก",
  "รายชื่อ elite บอสวันอาทิตย์",
  "ตี้วอวันอาทิตย์",
  "เช็คขาดลา",
];

const CLASS_TABS = [
  "Knight", "Paladin", "Hunter", "Assassin", "Wizard",
  "Priest", "Monk", "Blacksmith", "Gunslinger", "Druid"
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
