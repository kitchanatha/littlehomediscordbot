import type { MemberRepository } from "../repositories/member-repository.js";
import { VALID_TEAMS } from "../types/member.js";
import type { HistoryEntry, Member } from "../types/member.js";
import { generateNextId } from "../utils/id.js";
import { normalizeName } from "../utils/normalize.js";
import type { QueueService } from "./queue-service.js";
import type { ClassService } from "./class-service.js";
import type { SheetDisplayService } from "./sheet-display-service.js";
// Type-only: attendance-service.ts imports UserError from this module, so a runtime import
// here would be circular. `import type` is erased at compile time, so this is safe.
import type { AttendanceService } from "./attendance-service.js";

export class UserError extends Error {}

export class MemberService {
  constructor(
    private readonly repository: MemberRepository,
    private readonly classService: ClassService,
    private readonly sheetDisplayService: SheetDisplayService,
    private readonly queueService?: QueueService,
    private readonly attendanceService?: AttendanceService
  ) {}

  private now(): string {
    return new Date().toISOString();
  }

  async getActiveClasses(): Promise<string[]> {
    return this.classService.getActiveClasses();
  }

  async register(input: { discordId: string; discordUsername: string; characterName: string; className: string }): Promise<{ member: Member; legacyLinked: boolean }> {
    const existing = await this.repository.findByDiscordId(input.discordId);
    if (existing) {
      throw new UserError("❌ You are already registered. Use /name_class to update your profile.\n❌ คุณลงทะเบียนแล้ว หากต้องการแก้ไขข้อมูลให้ใช้ /name_class");
    }

    const classes = await this.getActiveClasses();
    const className = input.className.trim();
    const canonical = classes.find((c) => normalizeName(c) === normalizeName(className));
    if (!canonical) {
      throw new UserError("❌ Invalid class. Please select an active class.\n❌ อาชีพไม่ถูกต้อง กรุณาเลือกอาชีพจากรายการ");
    }

    const legacy = await this.repository.findLegacyByName(input.characterName);
    if (legacy && legacy.linkedDiscordId && legacy.linkedDiscordId !== input.discordId) {
      throw new UserError("❌ This legacy guild record has already been claimed by another user.");
    }

    const existingIds = await this.repository.getAllMemberIds();
    const memberId = generateNextId("M", existingIds);

    const now = this.now();
    const member: Member = {
      memberId,
      discordId: input.discordId,
      discordUsername: input.discordUsername,
      characterName: input.characterName.trim(),
      className: canonical,
      team: legacy?.team ?? "",
      party: legacy?.party ?? "",
      status: "Active",
      joinedDate: now,
      lastUpdated: now,
    };

    await this.repository.createMember(member);

    if (legacy) {
      await this.repository.linkLegacy(legacy.legacyName, input.discordId, memberId, now);
    }

    // Best-effort carryover from the transcribed in-game roster (see
    // Game_Roster_CombatPower) — this data source is optional, so a failure here shouldn't
    // fail the registration itself.
    try {
      const combatPower = await this.repository.findGameRosterCombatPower(member.characterName);
      if (combatPower) await this.repository.setCombatPower(memberId, combatPower);
    } catch (err) {
      console.error(`WARN Failed to carry over combat power for ${memberId}`, err);
    }

    // Best-effort: replay any War check-ins recorded while this Discord user was still
    // unregistered (see AttendanceService.checkInUnregistered / Pending_Attendance).
    if (this.attendanceService) {
      try {
        const count = await this.attendanceService.reconcilePendingAttendance(input.discordId, member.characterName, member.className);
        if (count > 0) console.log(`INFO Backfilled ${count} pending attendance record(s) for ${member.characterName}`);
      } catch (err) {
        console.error(`WARN Failed to reconcile pending attendance for ${memberId}`, err);
      }
    }

    return { member, legacyLinked: Boolean(legacy) };
  }

  async profile(discordId: string): Promise<Member> {
    const member = await this.repository.findByDiscordId(discordId);
    if (!member) throw new UserError("❌ You are not registered yet. Please use /register.");
    return member;
  }

  async changeName(discordId: string, newName: string): Promise<Member> {
    const { member } = await this.updateNameAndClass({
      targetDiscordId: discordId,
      newName,
      changedByDiscordId: discordId,
    });
    return member;
  }

  async changeClass(discordId: string, newClass: string): Promise<Member> {
    const { member } = await this.updateNameAndClass({
      targetDiscordId: discordId,
      newClass,
      changedByDiscordId: discordId,
    });
    return member;
  }

  async updateNameAndClass(input: {
    targetDiscordId: string;
    newName?: string;
    newClass?: string;
    changedByDiscordId: string;
  }): Promise<{ member: Member; nameChanged: boolean; classChanged: boolean }> {
    const member = await this.repository.findByDiscordId(input.targetDiscordId);
    if (!member) throw new UserError("❌ This user is not registered.");

    if (!input.newName && !input.newClass) {
      throw new UserError("❌ Please provide a new name, class, or both.");
    }

    const updates: { name?: string; className?: string } = {};
    const histories: HistoryEntry[] = [];
    const now = this.now();
    const currentHistoryIds = await this.repository.getAllHistoryIds();

    let nameChanged = false;
    if (input.newName) {
      const cleanName = input.newName.trim();
      if (!cleanName) throw new UserError("❌ Character name cannot be empty.");
      if (normalizeName(cleanName) !== normalizeName(member.characterName)) {
        nameChanged = true;
        updates.name = cleanName;
        histories.push({
          type: "name",
          historyId: generateNextId("H", [...currentHistoryIds, ...histories.map((h) => h.historyId)]),
          memberId: member.memberId,
          discordId: member.discordId,
          oldValue: member.characterName,
          newValue: cleanName,
          changedAt: now,
          changedBy: input.changedByDiscordId,
        });
      }
    }

    let classChanged = false;
    if (input.newClass) {
      const activeClasses = await this.repository.getActiveClasses();
      const canonicalClass = activeClasses.find((c) => normalizeName(c) === normalizeName(input.newClass!));
      if (!canonicalClass) {
        throw new UserError(`❌ Invalid class. Available classes: ${activeClasses.join(", ")}`);
      }
      if (normalizeName(canonicalClass) !== normalizeName(member.className)) {
        classChanged = true;
        updates.className = canonicalClass;
        histories.push({
          type: "class",
          historyId: generateNextId("H", [...currentHistoryIds, ...histories.map((h) => h.historyId)]),
          memberId: member.memberId,
          discordId: member.discordId,
          oldValue: member.className,
          newValue: canonicalClass,
          changedAt: now,
          changedBy: input.changedByDiscordId,
        });
      }
    }

    if (!nameChanged && !classChanged) {
      return { member, nameChanged: false, classChanged: false };
    }

    const audit = {
      action: "UPDATE_NAME_CLASS",
      targetMemberId: member.memberId,
      targetDiscordId: member.discordId,
      adminDiscordId: input.changedByDiscordId,
      oldValue1: nameChanged ? member.characterName : "",
      newValue1: nameChanged ? updates.name : "",
      oldValue2: classChanged ? member.className : "",
      newValue2: classChanged ? updates.className : "",
      timestamp: now,
    };

    const updated = await this.repository.updateNameAndClass(member, updates, histories, audit);
    
    if (this.queueService && (nameChanged || classChanged)) {
      await this.queueService.refreshVisualQueue().catch(err => {
        console.error("WARN Failed to refresh visual queue after name/class update", err);
      });
    }

    if (nameChanged || classChanged) {
      await this.sheetDisplayService.refreshAllMemberDisplays(member.memberId).catch(err => {
        console.error("WARN Failed to refresh sheet displays after name/class update", err);
      });
    }

    return { member: updated, nameChanged, classChanged };
  }

  async bulkRegister(users: { discordId: string; discordUsername: string }[]): Promise<{ registeredCount: number; skippedCount: number }> {
    const existingIds = await this.repository.getAllMemberIds();
    const existingDiscordIds = new Set(await this.repository.getAllDiscordIds());

    let nextMemberId = generateNextId("M", existingIds);
    const membersToCreate: Member[] = [];
    const now = this.now();

    for (const user of users) {
      if (existingDiscordIds.has(user.discordId)) continue;

      const member: Member = {
        memberId: nextMemberId,
        discordId: user.discordId,
        discordUsername: user.discordUsername,
        characterName: "",
        className: "",
        team: "",
        party: "",
        status: "Pending",
        joinedDate: now,
        lastUpdated: now,
      };
      membersToCreate.push(member);
      // Increment ID for next member in batch
      const currentIdNum = parseInt(nextMemberId.substring(1), 10);
      nextMemberId = `M${(currentIdNum + 1).toString().padStart(6, "0")}`;
    }

    if (membersToCreate.length > 0) {
      await this.repository.createMembersBulk(membersToCreate);
    }

    return {
      registeredCount: membersToCreate.length,
      skippedCount: users.length - membersToCreate.length,
    };
  }

  async history(discordId: string): Promise<HistoryEntry[]> {
    const member = await this.profile(discordId);
    return this.repository.getHistory(member.memberId);
  }

  async assignMember(input: { targetDiscordId: string; team: string; party: number; adminDiscordId: string }): Promise<Member> {
    const member = await this.repository.findByDiscordId(input.targetDiscordId);
    if (!member) throw new UserError("❌ This Discord user is not registered.");

    const normalizedTeam = input.team.trim().toUpperCase();
    if (!VALID_TEAMS.includes(normalizedTeam as (typeof VALID_TEAMS)[number])) {
      throw new UserError(`❌ Invalid team. Allowed values: ${VALID_TEAMS.join(", ")}`);
    }

    if (!Number.isInteger(input.party) || input.party < 1) throw new UserError("❌ Party must be a positive integer.");

    const updates: { team?: string; party?: string } = {};
    const histories: HistoryEntry[] = [];
    const now = this.now();

    const currentHistoryIds = await this.repository.getAllHistoryIds();
    let nextHistoryId = (prefix: string, ids: string[]) => generateNextId(prefix, ids);

    if (normalizedTeam !== member.team) {
      updates.team = normalizedTeam;
      const hId = nextHistoryId("H", [...currentHistoryIds, ...histories.map(h => h.historyId)]);
      histories.push({
        type: "team",
        historyId: hId,
        memberId: member.memberId,
        discordId: member.discordId,
        oldValue: member.team,
        newValue: normalizedTeam,
        changedAt: now,
        changedBy: input.adminDiscordId,
      });
    }

    const partyStr = String(input.party);
    if (partyStr !== member.party) {
      updates.party = partyStr;
      const hId = nextHistoryId("H", [...currentHistoryIds, ...histories.map(h => h.historyId)]);
      histories.push({
        type: "party",
        historyId: hId,
        memberId: member.memberId,
        discordId: member.discordId,
        oldValue: member.party,
        newValue: partyStr,
        changedAt: now,
        changedBy: input.adminDiscordId,
      });
    }

    if (Object.keys(updates).length === 0) {
      throw new UserError(`ℹ️ ${member.characterName} is already assigned to Team ${member.team} / Party ${member.party}.`);
    }

    const audit = {
      action: "ASSIGN_MEMBER",
      targetMemberId: member.memberId,
      targetDiscordId: member.discordId,
      adminDiscordId: input.adminDiscordId,
      oldTeam: member.team,
      newTeam: normalizedTeam,
      oldParty: member.party,
      newParty: partyStr,
      timestamp: now,
    };

    const updated = await this.repository.updateTeamAndParty(member, updates, histories, audit);

    if (Object.keys(updates).length > 0) {
      await this.sheetDisplayService.refreshAllMemberDisplays(member.memberId).catch(err => {
        console.error("WARN Failed to refresh sheet displays after assignment update", err);
      });
    }

    return updated;
  }

  async handleGuildMemberRemove(discordId: string): Promise<Member | null> {
    const member = await this.repository.findByDiscordId(discordId);
    if (!member || member.status === "Left") return null;

    const now = this.now();
    const audit = {
      action: "GUILD_MEMBER_LEFT",
      targetMemberId: member.memberId,
      targetDiscordId: member.discordId,
      adminDiscordId: "SYSTEM",
      oldValue1: member.status,
      newValue1: "Left",
      timestamp: now,
    };

    await this.repository.updateMemberStatus(member, "Left", now, audit);

    await this.sheetDisplayService.refreshAllMemberDisplays(member.memberId).catch(err => {
      console.error("WARN Failed to refresh sheet displays after member left", err);
    });

    if (this.queueService) {
      await this.queueService.cleanupMemberQueues(discordId).catch((err) => {
        console.error("WARN Failed to cleanup member queues after guild leave", err);
      });
    }

    return member;
  }

  async handleGuildMemberAdd(discordId: string, discordUsername: string): Promise<void> {
    const member = await this.repository.findByDiscordId(discordId);
    if (!member || member.status !== "Left") return;

    const now = this.now();
    const audit = {
      action: "GUILD_MEMBER_REJOINED",
      targetMemberId: member.memberId,
      targetDiscordId: member.discordId,
      adminDiscordId: "SYSTEM",
      oldValue1: member.status,
      newValue1: "Active",
      timestamp: now,
    };

    await this.repository.updateMemberStatus(member, "Active", now, audit, discordUsername);
  }

  async reconcileMembers(guildDiscordIds: string[]): Promise<{ leftCount: number }> {
    const activeMembers = await this.repository.getAllActiveMembers();
    const guildIdSet = new Set(guildDiscordIds);
    let leftCount = 0;

    for (const member of activeMembers) {
      if (!guildIdSet.has(member.discordId)) {
        // handleGuildMemberRemove does several Sheets API reads/writes (status update +
        // display refresh across sheets); pace these so reconciling many members at once
        // (e.g. after a bulk backfill) doesn't blow through the per-minute read quota.
        if (leftCount > 0) await this.sleep(3000);

        const removed = await this.handleGuildMemberRemove(member.discordId).catch((err) => {
          console.error(`ERROR Reconciliation failed for member ${member.discordId}`, err);
          return null;
        });
        if (removed) leftCount++;
      }
    }

    return { leftCount };
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
