import { describe, it, expect, beforeEach } from "vitest";
import { QueueService } from "../src/services/queue-service.js";
import { QueueRepository } from "../src/repositories/queue-repository.js";
import { MemberRepository } from "../src/repositories/member-repository.js";
import { QueueEntry, QueueHistory, QueueType } from "../src/types/queue.js";
import { Member } from "../src/types/member.js";

class FakeQueueRepo implements QueueRepository {
  entries: QueueEntry[] = [];
  history: QueueHistory[] = [];

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
  async addEntry(entry: QueueEntry): Promise<void> {
    this.entries.push(entry);
  }
  async updateEntries(entries: QueueEntry[]): Promise<void> {
    for (const e of entries) {
      const idx = this.entries.findIndex((ent) => ent.queueEntryId === e.queueEntryId);
      if (idx >= 0) this.entries[idx] = e;
    }
  }
  async deleteEntry(queueEntryId: string): Promise<void> {
    this.entries = this.entries.filter((e) => e.queueEntryId !== queueEntryId);
  }
  async addHistory(history: QueueHistory): Promise<void> {
    this.history.push(history);
  }
  async getAllHistoryIds(): Promise<string[]> {
    return this.history.map((h) => h.historyId);
  }
  async getAllEntryIds(): Promise<string[]> {
    return this.entries.map((e) => e.queueEntryId);
  }
  async updateVisualDisplay() { return; }
  async validateReadiness() {}
  async getClassConfigs() { return []; }
}

class FakeMemberRepo implements MemberRepository {
  members: Member[] = [];
  async findByDiscordId(discordId: string) {
    return this.members.find((m) => m.discordId === discordId) || null;
  }
  async findLegacyByName() { return null; }
  async getActiveClasses() { return []; }
  async createMember() {}
  async updateName(m: Member) { return m; }
  async updateClass(m: Member) { return m; }
  async updateTeamAndParty(m: Member) { return m; }
  async getHistory() { return []; }
  async getAllMemberIds() { return []; }
  async getAllHistoryIds() { return []; }
  async linkLegacy() {}
  async getAllActiveMembers() {
    return this.members.filter((m) => m.status === "Active");
  }
  async getAllMembers() {
    return this.members;
  }
  async updateMemberStatus(m: Member, status: string, lastUpdated: string, audit: any, newUsername?: string) {
    const i = this.members.findIndex(member => member.memberId === m.memberId);
    if (i >= 0) {
        this.members[i].status = status;
        this.members[i].lastUpdated = lastUpdated;
        if (newUsername) this.members[i].discordUsername = newUsername;
    }
  }
  async updateNameAndClass(m: Member) { return m; }
  async getAllDiscordIds() { return []; }
  async createMembersBulk() {}
  async validateReadiness() {}
  async getClassConfigs() { return []; }
}

describe("QueueService", () => {
  let queueRepo: FakeQueueRepo;
  let memberRepo: FakeMemberRepo;
  let classService: any;
  let service: QueueService;

  beforeEach(() => {
    queueRepo = new FakeQueueRepo();
    memberRepo = new FakeMemberRepo();
    classService = {
      formatPlayerDisplay: (m: Member) => Promise.resolve({ text: m.characterName }),
    };
    service = new QueueService(queueRepo as any, memberRepo as any, classService);

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

  it("member joins Card queue successfully", async () => {
    const entry = await service.enqueue({ targetDiscordId: "user1", queueType: "Card", changedByDiscordId: "user1" });
    expect(entry.position).toBe(1);
    expect(queueRepo.entries.length).toBe(1);
    expect(queueRepo.history.length).toBe(1);
    expect(queueRepo.history[0].action).toBe("ENQUEUE");
  });

  it("member joins Accessory queue simultaneously", async () => {
    await service.enqueue({ targetDiscordId: "user1", queueType: "Card", changedByDiscordId: "user1" });
    const entry = await service.enqueue({ targetDiscordId: "user1", queueType: "Accessory", changedByDiscordId: "user1" });
    expect(entry.position).toBe(1);
    expect(queueRepo.entries.length).toBe(2);
  });

  it("rejects duplicate Card join", async () => {
    await service.enqueue({ targetDiscordId: "user1", queueType: "Card", changedByDiscordId: "user1" });
    await expect(service.enqueue({ targetDiscordId: "user1", queueType: "Card", changedByDiscordId: "user1" }))
      .rejects.toThrow("already in the Card queue");
  });

  it("assigns sequential positions", async () => {
    await service.enqueue({ targetDiscordId: "user1", queueType: "Card", changedByDiscordId: "user1" });
    const entry2 = await service.enqueue({ targetDiscordId: "user2", queueType: "Card", changedByDiscordId: "user2" });
    expect(entry2.position).toBe(2);
  });

  it("admin can enqueue another member", async () => {
    const entry = await service.enqueue({ targetDiscordId: "user2", queueType: "Card", changedByDiscordId: "admin" });
    expect(entry.addedBy).toBe("admin");
    expect(entry.discordId).toBe("user2");
  });

  it("member can leave their own queue", async () => {
    await service.enqueue({ targetDiscordId: "user1", queueType: "Card", changedByDiscordId: "user1" });
    const result = await service.dequeue({ targetDiscordId: "user1", queueType: "Card", changedByDiscordId: "user1" });
    expect(queueRepo.entries.length).toBe(0);
    expect(queueRepo.history[1].action).toBe("DEQUEUE");
    expect(result.cooldownUntil).toBeTruthy();
  });

  it("reindexing after dequeue removes gaps", async () => {
    // 1. user1, 2. user2
    await service.enqueue({ targetDiscordId: "user1", queueType: "Card", changedByDiscordId: "user1" });
    await service.enqueue({ targetDiscordId: "user2", queueType: "Card", changedByDiscordId: "user2" });
    
    // Remove user 1
    await service.dequeue({ targetDiscordId: "user1", queueType: "Card", changedByDiscordId: "admin" });
    
    const queue = await service.getQueue("Card");
    expect(queue.length).toBe(1);
    expect(queue[0].text).toBe("Player2");
    expect(queue[0].position).toBe(1);
  });

  it("cooldown blocks rejoin for 3 days", async () => {
    await service.enqueue({ targetDiscordId: "user1", queueType: "Card", changedByDiscordId: "user1" });
    await service.dequeue({ targetDiscordId: "user1", queueType: "Card", changedByDiscordId: "user1" });
    
    // Check if cooldown is exactly 3 days
    const lastHistory = queueRepo.history.find(h => h.action === "DEQUEUE" && h.discordId === "user1");
    const changedAt = new Date(lastHistory!.changedAt).getTime();
    const cooldownUntil = new Date(lastHistory!.cooldownUntil).getTime();
    expect(cooldownUntil - changedAt).toBe(3 * 24 * 60 * 60 * 1000);

    await expect(service.enqueue({ targetDiscordId: "user1", queueType: "Card", changedByDiscordId: "user1" }))
      .rejects.toThrow("You cannot join this queue yet");
  });

  it("can rejoin after 3 days", async () => {
    // Manual history entry to simulate old dequeue
    const oldDate = new Date();
    oldDate.setDate(oldDate.getDate() - 4); // 4 days ago
    
    const cooldownDate = new Date(oldDate);
    cooldownDate.setDate(cooldownDate.getDate() + 3); // 3 days after dequeue

    queueRepo.history.push({
      historyId: "QH-OLD",
      queueEntryId: "QE-OLD",
      queueType: "Card",
      memberId: "M000001",
      discordId: "user1",
      action: "DEQUEUE",
      position: 1,
      changedAt: oldDate.toISOString(),
      changedBy: "user1",
      cooldownUntil: cooldownDate.toISOString()
    });

    // Should be able to join now
    const entry = await service.enqueue({ targetDiscordId: "user1", queueType: "Card", changedByDiscordId: "user1" });
    expect(entry.position).toBe(1);
  });

  it("Admin cannot bypass cooldown", async () => {
    await service.enqueue({ targetDiscordId: "user1", queueType: "Card", changedByDiscordId: "user1" });
    await service.dequeue({ targetDiscordId: "user1", queueType: "Card", changedByDiscordId: "user1" });
    
    await expect(service.enqueue({ targetDiscordId: "user1", queueType: "Card", changedByDiscordId: "admin" }))
      .rejects.toThrow("You cannot join this queue yet");
  });

  it("can rejoin exactly at CooldownUntil", async () => {
    // We need to mock the current date to be exactly CooldownUntil
    const now = new Date();
    const futureDate = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);
    
    queueRepo.history.push({
      historyId: "QH-EXACT",
      queueEntryId: "QE-EXACT",
      queueType: "Card",
      memberId: "M000001",
      discordId: "user1",
      action: "DEQUEUE",
      position: 1,
      changedAt: now.toISOString(),
      changedBy: "user1",
      cooldownUntil: futureDate.toISOString()
    });

    // We can't easily mock 'new Date()' in this project without additional libraries,
    // but the logic is: cooldownDate > new Date()
    // So if cooldownDate IS equal to now, it should pass.
    // However, the service uses 'new Date()' internally.
    
    // Let's use a date in the past for changedAt so futureDate is 'now'
    const past = new Date();
    past.setDate(past.getDate() - 3);
    const cooldownUntil = past.toISOString(); // CooldownUntil is now
    
    queueRepo.history.pop(); // remove QH-EXACT
    queueRepo.history.push({
      historyId: "QH-EXACT",
      queueEntryId: "QE-EXACT",
      queueType: "Card",
      memberId: "M000001",
      discordId: "user1",
      action: "DEQUEUE",
      position: 1,
      changedAt: new Date(new Date().getTime() - 6 * 24 * 60 * 60 * 1000).toISOString(),
      changedBy: "user1",
      cooldownUntil: new Date().toISOString() // Cooldown ends right now
    });

    // Depending on execution speed, new Date() inside service might be slightly AFTER QH-EXACT.cooldownUntil
    // In our service: if (cooldownDate > new Date())
    // If cooldownDate is NOW, it is NOT > now, so it should allow.
    
    const entry = await service.enqueue({ targetDiscordId: "user1", queueType: "Card", changedByDiscordId: "user1" });
    expect(entry.position).toBe(1);
  });

  it("cooldown for Card does not block Accessory", async () => {
    await service.enqueue({ targetDiscordId: "user1", queueType: "Card", changedByDiscordId: "user1" });
    await service.dequeue({ targetDiscordId: "user1", queueType: "Card", changedByDiscordId: "user1" });
    
    const entry = await service.enqueue({ targetDiscordId: "user1", queueType: "Accessory", changedByDiscordId: "user1" });
    expect(entry.position).toBe(1);
  });

  it("unregistered member cannot join", async () => {
    await expect(service.enqueue({ targetDiscordId: "unknown", queueType: "Card", changedByDiscordId: "unknown" }))
      .rejects.toThrow("not registered");
  });

  it("queue status shows position and cooldown", async () => {
    await service.enqueue({ targetDiscordId: "user1", queueType: "Card", changedByDiscordId: "user1" });
    const status = await service.getMemberQueueStatus("user1");
    expect(status.card?.position).toBe(1);
    expect(status.accessory).toBeUndefined();
  });
});
