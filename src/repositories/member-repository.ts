import type { HistoryEntry, LegacyMember, Member } from "../types/member.js";
import type { ClassConfig } from "../types/class.js";

export interface MemberRepository {
  findByDiscordId(discordId: string): Promise<Member | null>;
  findLegacyByName(characterName: string): Promise<LegacyMember | null>;
  getActiveClasses(): Promise<string[]>;
  getClassConfigs(): Promise<ClassConfig[]>;
  createMember(member: Member): Promise<void>;
  updateTeamAndParty(member: Member, updates: { team?: string; party?: string }, histories: HistoryEntry[], audit: any): Promise<Member>;
  getHistory(memberId: string): Promise<HistoryEntry[]>;
  getAllMemberIds(): Promise<string[]>;
  getAllHistoryIds(): Promise<string[]>;
  linkLegacy(legacyName: string, discordId: string, memberId: string, linkedAt: string): Promise<void>;
  getAllActiveMembers(): Promise<Member[]>;
  updateNameAndClass(
    member: Member,
    updates: { name?: string; className?: string },
    histories: HistoryEntry[],
    audit: any
  ): Promise<Member>;
  getAllDiscordIds(): Promise<string[]>;
  createMembersBulk(members: Member[]): Promise<void>;
  updateMemberStatus(
    member: Member,
    status: string,
    lastUpdated: string,
    audit: any,
    newUsername?: string
  ): Promise<void>;
  getAllMembers(): Promise<Member[]>;
  validateReadiness(): Promise<void>;
  // Looks up a character's combat power ("Gear Rating") from the transcribed in-game roster
  // (Game_Roster_CombatPower), independent of Discord registration. Returns null if that
  // character isn't in the transcribed roster yet.
  findGameRosterCombatPower(characterName: string): Promise<string | null>;
  setCombatPower(memberId: string, combatPower: string): Promise<void>;
  // Class-color admin tooling: write the new hex to the Classes tab, then repaint everywhere
  // that color was already baked in (Members/display rows written on the fly, and the จัดตี้
  // tab's conditional-format rules which are baked-in literals with no live link back here).
  updateClassColorHex(className: string, colorHex: string): Promise<void>;
  recolorMembersByClass(className: string, colorHex: string): Promise<number>;
  recolorJadtiClass(className: string, colorHex: string): Promise<number>;
}
