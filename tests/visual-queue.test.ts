import { describe, it, expect, beforeEach, vi } from "vitest";
import { QueueService } from "../src/services/queue-service.js";
import { QueueRepository } from "../src/repositories/queue-repository.js";
import { MemberRepository } from "../src/repositories/member-repository.js";
import { QueueEntry, QueueHistory, QueueType } from "../src/types/queue.js";
import { Member } from "../src/types/member.js";
import { MemberService } from "../src/services/member-service.js";

class FakeQueueRepo implements QueueRepository {
  entries: QueueEntry[] = [];
  history: QueueHistory[] = [];
  lastCardQueue: any[] = [];
  lastAccessoryQueue: any[] = [];

  async getAllActiveEntries(queueType: QueueType): Promise<QueueEntry[]> {
    return this.entries.filter((e) => e.queueType === queueType && e.status === "Active").sort((a, b) => a.position - b.position);
  }
  async findActiveEntry(discordId: string, queueType: QueueType): Promise<QueueEntry | null> {
    return this.entries.find((e) => e.discordId === discordId && e.queueType === queueType && e.status === "Active") || null;
  }
  async getLastHistory(discordId: string, queueType: QueueType): Promise<QueueHistory | null> {
    const relevant = this.history.filter((h) => h.discordId === discordId && h.queueType === queueType && h.action === "DEQUEUE");
    if (relevant.length === 0) return null;
    return relevant.sort((a, b) => b.changedAt.localeCompare(a.changedAt))[0];
  }
  async addEntry(entry: QueueEntry): Promise<void> { this.entries.push(entry); }
  async updateEntries(entries: QueueEntry[]): Promise<void> {
    for (const e of entries) {
      const idx = this.entries.findIndex((ent) => ent.queueEntryId === e.queueEntryId);
      if (idx >= 0) this.entries[idx] = e;
    }
  }
  async deleteEntry(queueEntryId: string): Promise<void> {
    this.entries = this.entries.filter((e) => e.queueEntryId !== queueEntryId);
  }
  async addHistory(history: QueueHistory): Promise<void> { this.history.push(history); }
  async getAllHistoryIds(): Promise<string[]> { return this.history.map((h) => h.historyId); }
  async getAllEntryIds(): Promise<string[]> { return this.entries.map((e) => e.queueEntryId); }
  
  async updateVisualDisplay(cardQueue: any[], accessoryQueue: any[]): Promise<void> {
    this.lastCardQueue = cardQueue;
    this.lastAccessoryQueue = accessoryQueue;
  }
  async validateReadiness() {}
  async getClassConfigs() { return []; }
}

class FakeMemberRepo implements MemberRepository {
  members: Member[] = [];
  async findByDiscordId(discordId: string) { return this.members.find((m) => m.discordId === discordId) || null; }
  async findLegacyByName() { return null; }
  async getActiveClasses() { return ["Knight", "Priest", "Wizard"]; }
  async createMember() {}
  async updateName(m: Member) { return m; }
  async updateClass(m: Member) { return m; }
  async updateTeamAndParty(m: Member) { return m; }
  async getHistory() { return []; }
  async getAllActiveMembers() { return this.members.filter((m) => m.status === "Active"); }
  async getAllMembers() { return this.members; }
  async getAllMemberIds() { return this.members.map(m => m.memberId); }
  async getAllHistoryIds() { return []; }
  async linkLegacy() {}
  async updateMemberStatus(m: Member, status: string, lastUpdated: string, audit: any, newUsername?: string) {
    const i = this.members.findIndex(member => member.memberId === m.memberId);
    if (i >= 0) {
        this.members[i].status = status;
        this.members[i].lastUpdated = lastUpdated;
        if (newUsername) this.members[i].discordUsername = newUsername;
    }
  }
  async updateNameAndClass(m: Member, updates: any, histories: any, audit: any) {
    const index = this.members.findIndex(member => member.memberId === m.memberId);
    this.members[index] = { ...m, characterName: updates.name ?? m.characterName, className: updates.className ?? m.className };
    return this.members[index];
  }
  async getAllDiscordIds() { return []; }
  async createMembersBulk() {}
  async validateReadiness() {}
  async getClassConfigs() { return []; }
  async findGameRosterCombatPower() { return null; }
  async setCombatPower() {}
}

describe("Visual Queue Update", () => {
  let queueRepo: FakeQueueRepo;
  let memberRepo: FakeMemberRepo;
  let classService: any;
  let displayService: any;
  let queueService: QueueService;
  let memberService: MemberService;

  beforeEach(() => {
    queueRepo = new FakeQueueRepo();
    memberRepo = new FakeMemberRepo();
    classService = {
      getActiveClasses: () => Promise.resolve(["Knight", "Priest", "Wizard"]),
      formatPlayerDisplay: (m: Member) => Promise.resolve({ text: m.characterName, className: m.className, symbol: "S", colorHex: "#000" }),
    };
    displayService = {
      refreshAllMemberDisplays: () => Promise.resolve(),
    };
    queueService = new QueueService(queueRepo as any, memberRepo as any, classService);
    memberService = new MemberService(memberRepo as any, classService, displayService, queueService);

    memberRepo.members.push({
      memberId: "M000001",
      discordId: "user1",
      discordUsername: "user1",
      characterName: "Player1",
      className: "Knight",
      status: "Active",
      team: "",
      party: "",
      joinedDate: "",
      lastUpdated: "",
    });
    memberRepo.members.push({
      memberId: "M000002",
      discordId: "user2",
      discordUsername: "user2",
      characterName: "Player2",
      className: "Priest",
      status: "Active",
      team: "",
      party: "",
      joinedDate: "",
      lastUpdated: "",
    });
  });

  it("updates visual display on enqueue", async () => {
    await queueService.enqueue({ targetDiscordId: "user1", queueType: "Card", changedByDiscordId: "user1" });
    
    expect(queueRepo.lastCardQueue).toHaveLength(1);
    expect(queueRepo.lastCardQueue[0]).toMatchObject({
      position: 1,
      text: "Player1",
      className: "Knight"
    });
    expect(queueRepo.lastAccessoryQueue).toHaveLength(0);
  });

  it("updates visual display on dequeue and reindexes", async () => {
    await queueService.enqueue({ targetDiscordId: "user1", queueType: "Card", changedByDiscordId: "user1" });
    await queueService.enqueue({ targetDiscordId: "user2", queueType: "Card", changedByDiscordId: "user2" });
    
    await queueService.dequeue({ targetDiscordId: "user1", queueType: "Card", changedByDiscordId: "user1" });
    
    expect(queueRepo.lastCardQueue).toHaveLength(1);
    expect(queueRepo.lastCardQueue[0]).toMatchObject({
      position: 1,
      text: "Player2",
      className: "Priest"
    });
  });

  it("updates visual display when member changes name or class", async () => {
    await queueService.enqueue({ targetDiscordId: "user1", queueType: "Card", changedByDiscordId: "user1" });
    
    // Change name
    await memberService.updateNameAndClass({
      targetDiscordId: "user1",
      newName: "NewPlayer1",
      changedByDiscordId: "user1"
    });
    
    expect(queueRepo.lastCardQueue[0].text).toBe("NewPlayer1");
    
    // Change class
    await memberService.updateNameAndClass({
      targetDiscordId: "user1",
      newClass: "Wizard",
      changedByDiscordId: "user1"
    });
    
    expect(queueRepo.lastCardQueue[0].className).toBe("Wizard");
  });

  it("separates Card and Accessory queues in visual display", async () => {
    await queueService.enqueue({ targetDiscordId: "user1", queueType: "Card", changedByDiscordId: "user1" });
    await queueService.enqueue({ targetDiscordId: "user2", queueType: "Accessory", changedByDiscordId: "user2" });
    
    expect(queueRepo.lastCardQueue).toHaveLength(1);
    expect(queueRepo.lastCardQueue[0].text).toBe("Player1");
    
    expect(queueRepo.lastAccessoryQueue).toHaveLength(1);
    expect(queueRepo.lastAccessoryQueue[0].text).toBe("Player2");
  });
});
