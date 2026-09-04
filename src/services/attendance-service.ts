import type { MemberRepository } from "../repositories/member-repository.js";
import type { AttendanceRepository } from "../repositories/attendance-repository.js";
import type { Member } from "../types/member.js";
import { normalizeName } from "../utils/normalize.js";
import { UserError } from "./member-service.js";

export class AttendanceService {
  constructor(
    private readonly attendanceRepository: AttendanceRepository,
    private readonly memberRepository: MemberRepository
  ) {}

  private async resolveActiveMember(discordId: string) {
    const member = await this.memberRepository.findByDiscordId(discordId);
    if (!member) {
      throw new UserError("❌ You are not registered. Please use /register first.\n❌ คุณยังไม่ได้ลงทะเบียน กรุณาใช้ /register");
    }
    if (member.status !== "Active") {
      throw new UserError(`❌ Your membership status is "${member.status}", not Active.`);
    }
    return member;
  }

  private async mirrorToRoster(characterName: string, status: "มา" | "แจ้งลาแล้ว", at: Date): Promise<void> {
    try {
      await this.attendanceRepository.markRosterCheckin(characterName, status, at);
    } catch (error) {
      console.error(`ERROR Failed to mirror check-in to roster sheet for ${characterName}`, error);
    }
  }

  async checkIn(discordId: string): Promise<{ characterName: string; dateLabel: string }> {
    const member = await this.resolveActiveMember(discordId);
    const result = await this.attendanceRepository.markAttendance(member.characterName, member.className, "มา", new Date());
    await this.mirrorToRoster(member.characterName, "มา", new Date());
    return { characterName: member.characterName, dateLabel: result.dateLabel };
  }

  async requestLeave(discordId: string): Promise<{ characterName: string; dateLabel: string }> {
    const member = await this.resolveActiveMember(discordId);
    const result = await this.attendanceRepository.markAttendance(member.characterName, member.className, "แจ้งลาแล้ว", new Date());
    await this.mirrorToRoster(member.characterName, "แจ้งลาแล้ว", new Date());
    return { characterName: member.characterName, dateLabel: result.dateLabel };
  }

  /** For a Discord user who isn't registered yet — recorded separately, resolved once they register. */
  async checkInUnregistered(discordId: string, displayName: string): Promise<void> {
    await this.attendanceRepository.recordPendingCheckIn(discordId, displayName, "มา", new Date());
  }

  /** Call once a Discord user registers: replays any pending check-ins under their real name/class. */
  async reconcilePendingAttendance(discordId: string, characterName: string, className: string): Promise<number> {
    const pending = await this.attendanceRepository.resolvePendingCheckIns(discordId);
    for (const entry of pending) {
      await this.attendanceRepository.markAttendance(characterName, className, entry.status, entry.at);
    }
    return pending.length;
  }

  /** Active members not yet marked present today — backs the admin check-in panel's list. */
  async getMembersNeedingCheckIn(): Promise<Member[]> {
    const [members, presentToday] = await Promise.all([
      this.memberRepository.getAllActiveMembers(),
      this.attendanceRepository.getPresentTodayNormalizedNames(new Date()),
    ]);
    return members
      .filter((m) => !presentToday.has(normalizeName(m.characterName)))
      .sort((a, b) => a.characterName.localeCompare(b.characterName));
  }

  /** Checks in a specific member by ID — used by the admin check-in panel's buttons. */
  async checkInMember(memberId: string): Promise<{ characterName: string; dateLabel: string }> {
    const members = await this.memberRepository.getAllActiveMembers();
    const member = members.find((m) => m.memberId === memberId);
    if (!member) throw new UserError("❌ Member not found.");
    const result = await this.attendanceRepository.markAttendance(member.characterName, member.className, "มา", new Date());
    await this.mirrorToRoster(member.characterName, "มา", new Date());
    return { characterName: member.characterName, dateLabel: result.dateLabel };
  }

  /**
   * Checks in every registered, active member among the given Discord IDs who isn't already
   * present today — backs the panel's "Sync from Voice" button (pass the IDs of everyone
   * currently connected to the War voice channel). Unregistered IDs are silently skipped, not
   * an error — that's the pending-check-in path's job, not this one's.
   */
  async checkInMembersByDiscordIds(discordIds: string[]): Promise<string[]> {
    const [members, presentToday] = await Promise.all([
      this.memberRepository.getAllActiveMembers(),
      this.attendanceRepository.getPresentTodayNormalizedNames(new Date()),
    ]);
    const byDiscordId = new Map(members.map((m) => [m.discordId, m]));

    const checkedIn: string[] = [];
    for (const discordId of discordIds) {
      const member = byDiscordId.get(discordId);
      if (!member || presentToday.has(normalizeName(member.characterName))) continue;
      try {
        await this.attendanceRepository.markAttendance(member.characterName, member.className, "มา", new Date());
        checkedIn.push(member.characterName);
      } catch (error) {
        console.error(`ERROR Sync-from-voice check-in failed for ${member.characterName}`, error);
      }
    }
    return checkedIn;
  }
}
