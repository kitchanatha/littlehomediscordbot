import { describe, expect, it } from "vitest";
import type { MemberRepository } from "../src/repositories/member-repository.js";
import { MemberService } from "../src/services/member-service.js";
import { QueueService } from "../src/services/queue-service.js";
import type { Member } from "../src/types/member.js";
import type { QueueEntry, QueueHistory, QueueType } from "../src/types/queue.js";
import type { QueueRepository } from "../src/repositories/queue-repository.js";

class FakeQueueRepo implements QueueRepository {
  entries: QueueEntry[] = [];
  history: QueueHistory[] = [];

  async getAllActiveEntries(type: QueueType) {
    return this.entries.filter(e => e.queueType === type && e.status === "Active").sort((a, b) => a.position - b.position);
  }
  async findActiveEntry(discordId: string, type: QueueType) {
    return this.entries.find(e => e.discordId === discordId && e.queueType === type && e.status === "Active") || null;
  }
  async getLastHistory(discordId: string, type: QueueType) {
    const h = this.history.filter(h => h.discordId === discordId && h.queueType === type && h.action === "DEQUEUE");
    return h.sort((a, b) => b.changedAt.localeCompare(a.changedAt))[0] || null;
  }
  async addEntry(e: QueueEntry) { this.entries.push(e); }
  async updateEntries(updates: QueueEntry[]) {
    for (const u of updates) {
      const i = this.entries.findIndex(e => e.queueEntryId === u.queueEntryId);
      if (i >= 0) this.entries[i] = u;
    }
  }
  async deleteEntry(id: string) {
    const i = this.entries.findIndex(e => e.queueEntryId === id);
    if (i >= 0) this.entries.splice(i, 1);
  }
  async addHistory(h: QueueHistory) { this.history.push(h); }
  async getAllHistoryIds() { return this.history.map(h => h.historyId); }
  async getAllEntryIds() { return this.entries.map(e => e.queueEntryId); }
  async updateVisualDisplay() {}
  async validateReadiness() {}
  async getClassConfigs() { return []; }
}

class FakeMemberRepo implements MemberRepository {
  members: Member[] = [];
  async findByDiscordId(id: string) { return this.members.find(m => m.discordId === id) || null; }
  async findLegacyByName() { return null; }
  async getActiveClasses() { return []; }
  async createMember(m: Member) { this.members.push(m); }
  async updateName(m: Member) { return m; }
  async updateClass(m: Member) { return m; }
  async updateTeamAndParty(m: Member) { return m; }
  async getHistory() { return []; }
  async getAllMemberIds() { return this.members.map(m => m.memberId); }
  async getAllHistoryIds() { return []; }
  async linkLegacy() {}
  async getAllActiveMembers() { return this.members.filter(m => m.status === "Active"); }
  async getAllMembers() { return this.members; }
  async updateNameAndClass(m: Member) { return m; }
  async getAllDiscordIds() { return this.members.map(m => m.discordId); }
  async createMembersBulk() {}
  async validateReadiness() {}
  async getClassConfigs() { return []; }
  async findGameRosterCombatPower() { return null; }
  async setCombatPower() {}
  async updateMemberStatus(m: Member, status: string, lastUpdated: string, audit: any, newUsername?: string) {
    const i = this.members.findIndex(member => member.memberId === m.memberId);
    if (i >= 0) {
        this.members[i].status = status;
        this.members[i].lastUpdated = lastUpdated;
        if (newUsername) this.members[i].discordUsername = newUsername;
    }
  }
}

describe("Guild Events Handling", () => {
  const createServices = (memberRepo: MemberRepository, queueRepo: QueueRepository) => {
    const classService: any = {
      formatPlayerDisplay: (m: Member) => Promise.resolve({ text: m.characterName }),
    };
    const displayService: any = {
      refreshAllMemberDisplays: () => Promise.resolve(),
    };
    const queueService = new QueueService(queueRepo as any, memberRepo, classService);
    const memberService = new MemberService(memberRepo, classService, displayService, queueService);
    return { queueService, memberService, classService, displayService };
  };

  it("marks member as Left and cleans up queues on guildMemberRemove", async () => {
    const memberRepo = new FakeMemberRepo();
    const queueRepo = new FakeQueueRepo();
    const { memberService } = createServices(memberRepo, queueRepo as any);

    // Setup: registered member in both queues
    const member: Member = {
      memberId: "M000001",
      discordId: "user123",
      discordUsername: "oldname",
      characterName: "PlayerOne",
      className: "Knight",
      team: "A",
      party: "1",
      status: "Active",
      joinedDate: "2026-01-01T00:00:00Z",
      lastUpdated: "2026-01-01T00:00:00Z"
    };
    memberRepo.members.push(member);

    queueRepo.entries.push({
      queueEntryId: "QE000001",
      queueType: "Card",
      memberId: "M000001",
      discordId: "user123",
      position: 1,
      status: "Active",
      queuedAt: "2026-01-02T00:00:00Z",
      addedBy: "user123",
      lastUpdated: "2026-01-02T00:00:00Z"
    });
    queueRepo.entries.push({
      queueEntryId: "QE000002",
      queueType: "Accessory",
      memberId: "M000001",
      discordId: "user123",
      position: 1,
      status: "Active",
      queuedAt: "2026-01-02T00:00:00Z",
      addedBy: "user123",
      lastUpdated: "2026-01-02T00:00:00Z"
    });

    // Act
    await memberService.handleGuildMemberRemove("user123");

    // Assert
    expect(member.status).toBe("Left");
    expect(queueRepo.entries).toHaveLength(0);
    
    // Check history: DEQUEUE with no cooldown
    expect(queueRepo.history).toHaveLength(2);
    expect(queueRepo.history[0].action).toBe("DEQUEUE");
    expect(queueRepo.history[0].cooldownUntil).toBe("");
    expect(queueRepo.history[0].changedBy).toBe("SYSTEM");
  });

  it("re-activates Left member on guildMemberAdd and updates username", async () => {
    const memberRepo = new FakeMemberRepo();
    const queueRepo = new FakeQueueRepo();
    const { memberService } = createServices(memberRepo, queueRepo as any);

    const member: Member = {
      memberId: "M000001",
      discordId: "user123",
      discordUsername: "oldname",
      characterName: "PlayerOne",
      className: "Knight",
      team: "A",
      party: "1",
      status: "Left",
      joinedDate: "2026-01-01T00:00:00Z",
      lastUpdated: "2026-01-01T00:00:00Z"
    };
    memberRepo.members.push(member);

    // Act
    await memberService.handleGuildMemberAdd("user123", "newname");

    // Assert
    expect(member.status).toBe("Active");
    expect(member.discordUsername).toBe("newname");
  });

  it("reconciles members by marking missing ones as Left", async () => {
    const memberRepo = new FakeMemberRepo();
    const queueRepo = new FakeQueueRepo();
    const { memberService } = createServices(memberRepo, queueRepo as any);

    memberRepo.members.push(
      { discordId: "in_guild", status: "Active", memberId: "M1" } as Member,
      { discordId: "not_in_guild", status: "Active", memberId: "M2" } as Member
    );

    // Act
    const result = await memberService.reconcileMembers(["in_guild"]);

    // Assert
    expect(result.leftCount).toBe(1);
    expect(memberRepo.members.find(m => m.discordId === "not_in_guild")?.status).toBe("Left");
    expect(memberRepo.members.find(m => m.discordId === "in_guild")?.status).toBe("Active");
  });
});
