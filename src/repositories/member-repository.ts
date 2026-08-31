import type { HistoryEntry, LegacyMember, Member } from "../types/member.js";

export interface MemberRepository {
  findByDiscordId(discordId: string): Promise<Member | null>;
  findLegacyByName(characterName: string): Promise<LegacyMember | null>;
  getActiveClasses(): Promise<string[]>;
  createMember(member: Member): Promise<void>;
  updateName(member: Member, newName: string, history: HistoryEntry): Promise<Member>;
  updateClass(member: Member, newClass: string, history: HistoryEntry): Promise<Member>;
  getHistory(memberId: string): Promise<HistoryEntry[]>;
  getAllMemberIds(): Promise<string[]>;
  getAllHistoryIds(): Promise<string[]>;
}
