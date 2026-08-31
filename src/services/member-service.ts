import type { MemberRepository } from "../repositories/member-repository.js";
import type { HistoryEntry, Member } from "../types/member.js";
import { generateNextId } from "../utils/id.js";
import { normalizeName } from "../utils/normalize.js";

export class UserError extends Error {}

export class MemberService {
  constructor(private readonly repository: MemberRepository) {}

  private now(): string {
    return new Date().toISOString();
  }

  async register(input: { discordId: string; discordUsername: string; characterName: string; className?: string }): Promise<{ member: Member; legacyLinked: boolean; classOverridden: boolean }> {
    const existing = await this.repository.findByDiscordId(input.discordId);
    if (existing) throw new UserError("❌ You are already registered. Use /profile to view your data.");

    const classes = await this.repository.getActiveClasses();
    const legacy = await this.repository.findLegacyByName(input.characterName);

    const requestedClass = input.className?.trim();
    let classOverridden = false;
    let className = "";

    if (legacy) {
      className = legacy.className;
      if (requestedClass && normalizeName(requestedClass) !== normalizeName(legacy.className)) {
        classOverridden = true;
      }
    } else {
      className = requestedClass || "";
    }

    if (!className) throw new UserError("❌ I couldn't find your old guild record. Please run /register again and provide your class.");

    const canonical = classes.find((c) => normalizeName(c) === normalizeName(className));
    if (!canonical) throw new UserError(`❌ Invalid class. Available classes: ${classes.join(", ")}`);
    className = canonical;

    const existingIds = await this.repository.getAllMemberIds();
    const memberId = generateNextId("M", existingIds);

    const now = this.now();
    const member: Member = {
      memberId,
      discordId: input.discordId,
      discordUsername: input.discordUsername,
      characterName: input.characterName.trim(),
      className,
      team: legacy?.team ?? "",
      party: legacy?.party ?? "",
      status: "Active",
      joinedDate: now,
      lastUpdated: now,
    };

    await this.repository.createMember(member);
    return { member, legacyLinked: Boolean(legacy), classOverridden };
  }

  async profile(discordId: string): Promise<Member> {
    const member = await this.repository.findByDiscordId(discordId);
    if (!member) throw new UserError("❌ You are not registered yet. Please use /register.");
    return member;
  }

  async changeName(discordId: string, newName: string): Promise<Member> {
    const member = await this.profile(discordId);
    const clean = newName.trim();
    if (!clean) throw new UserError("❌ Character name cannot be empty.");
    if (normalizeName(clean) === normalizeName(member.characterName)) throw new UserError("❌ That is already your current character name.");

    const existingHistoryIds = await this.repository.getAllHistoryIds();
    const historyId = generateNextId("H", existingHistoryIds);

    const changedAt = this.now();
    const history: HistoryEntry = {
      type: "name",
      historyId,
      memberId: member.memberId,
      discordId: member.discordId,
      oldValue: member.characterName,
      newValue: clean,
      changedAt,
      changedBy: discordId,
    };
    return this.repository.updateName(member, clean, history);
  }

  async changeClass(discordId: string, newClass: string): Promise<Member> {
    const member = await this.profile(discordId);
    const classes = await this.repository.getActiveClasses();
    const canonical = classes.find((c) => normalizeName(c) === normalizeName(newClass));
    if (!canonical) throw new UserError(`❌ Invalid class. Available classes: ${classes.join(", ")}`);
    if (normalizeName(canonical) === normalizeName(member.className)) throw new UserError("❌ That is already your current class.");

    const existingHistoryIds = await this.repository.getAllHistoryIds();
    const historyId = generateNextId("H", existingHistoryIds);

    const changedAt = this.now();
    const history: HistoryEntry = {
      type: "class",
      historyId,
      memberId: member.memberId,
      discordId: member.discordId,
      oldValue: member.className,
      newValue: canonical,
      changedAt,
      changedBy: discordId,
    };
    return this.repository.updateClass(member, canonical, history);
  }

  async history(discordId: string): Promise<HistoryEntry[]> {
    const member = await this.profile(discordId);
    return this.repository.getHistory(member.memberId);
  }
}
