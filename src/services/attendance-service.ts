import type { MemberRepository } from "../repositories/member-repository.js";
import type { AttendanceRepository } from "../repositories/attendance-repository.js";
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

  async checkIn(discordId: string): Promise<{ characterName: string; dateLabel: string }> {
    const member = await this.resolveActiveMember(discordId);
    const result = await this.attendanceRepository.markAttendance(member.characterName, member.className, "มา", new Date());
    return { characterName: member.characterName, dateLabel: result.dateLabel };
  }

  async requestLeave(discordId: string): Promise<{ characterName: string; dateLabel: string }> {
    const member = await this.resolveActiveMember(discordId);
    const result = await this.attendanceRepository.markAttendance(member.characterName, member.className, "แจ้งลาแล้ว", new Date());
    return { characterName: member.characterName, dateLabel: result.dateLabel };
  }
}
