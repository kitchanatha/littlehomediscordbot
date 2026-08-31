import { describe, expect, it } from "vitest";
import type { MemberRepository } from "../src/repositories/member-repository.js";
import { MemberService, UserError } from "../src/services/member-service.js";
import type { HistoryEntry, LegacyMember, Member } from "../src/types/member.js";
import { normalizeName } from "../src/utils/normalize.js";

class FakeRepo implements MemberRepository {
  members: Member[] = [];
  history: HistoryEntry[] = [];
  legacy: LegacyMember | null = null;
  classes = ["Knight", "Hunter", "Priest", "Wizard"];

  async findByDiscordId(discordId: string) { return this.members.find(m => m.discordId === discordId) || null; }
  async findLegacyByName(name: string) { return null; }
  async getActiveClasses() { return this.classes; }
  async createMember(m: Member) { this.members.push(m); }
  async updateName(m: Member, v: string, h: HistoryEntry) {
    this.history.push(h);
    const index = this.members.findIndex(member => member.memberId === m.memberId);
    this.members[index] = { ...m, characterName: v, lastUpdated: h.changedAt };
    return this.members[index];
  }
  async updateClass(m: Member, v: string, h: HistoryEntry) {
    this.history.push(h);
    const index = this.members.findIndex(member => member.memberId === m.memberId);
    this.members[index] = { ...m, className: v, lastUpdated: h.changedAt };
    return this.members[index];
  }
  async updateTeamAndParty(m: Member, updates: any, histories: HistoryEntry[], audit: any) {
    this.history.push(...histories);
    return { ...m, ...updates };
  }
  async updateNameAndClass(m: Member, updates: { name?: string; className?: string }, histories: HistoryEntry[], audit: any) {
    this.history.push(...histories);
    const index = this.members.findIndex(member => member.memberId === m.memberId);
    this.members[index] = { 
        ...m, 
        characterName: updates.name ?? m.characterName, 
        className: updates.className ?? m.className,
        lastUpdated: histories[0]?.changedAt || m.lastUpdated
    };
    return this.members[index];
  }
  async getHistory(memberId: string) { return this.history.filter(h => h.memberId === memberId); }
  async getAllMemberIds() { return this.members.map(m => m.memberId); }
  async getAllHistoryIds() { return this.history.map(h => h.historyId); }
  async linkLegacy() {}
  async getAllActiveMembers() { return this.members.filter(m => m.status === "Active"); }
  async getAllMembers() { return this.members; }
  async getAllDiscordIds() { return this.members.map(m => m.discordId); }
  async createMembersBulk(members: Member[]) { this.members.push(...members); }
  async updateMemberStatus(m: Member, status: string, lastUpdated: string, audit: any, newUsername?: string) {
    const i = this.members.findIndex(member => member.memberId === m.memberId);
    if (i >= 0) {
        this.members[i].status = status;
        this.members[i].lastUpdated = lastUpdated;
        if (newUsername) this.members[i].discordUsername = newUsername;
    }
  }
  async validateReadiness() {}
  async getClassConfigs() { return []; }
}

describe("MemberService.updateNameAndClass", () => {
  const createServices = (repo: MemberRepository) => {
    const classService: any = {
      getActiveClasses: () => Promise.resolve(["Knight", "Hunter", "Priest", "Wizard"]),
      formatPlayerDisplay: (m: Member) => Promise.resolve({ text: m.characterName }),
      getClassPresentation: () => Promise.resolve({ className: "Knight", symbol: "K", colorHex: "#000" }),
    };
    const displayService: any = {
      refreshAllMemberDisplays: () => Promise.resolve(),
    };
    const service = new MemberService(repo, classService, displayService);
    return { service, classService, displayService };
  };
  it("updates own name and class", async () => {
    const repo = new FakeRepo();
    const { service } = createServices(repo);
    await service.register({ discordId: "123", discordUsername: "user", characterName: "Piko", className: "Knight" });

    const { member, nameChanged, classChanged } = await service.updateNameAndClass({
      targetDiscordId: "123",
      newName: "PikoX",
      newClass: "Hunter",
      changedByDiscordId: "123"
    });

    expect(nameChanged).toBe(true);
    expect(classChanged).toBe(true);
    expect(member.characterName).toBe("PikoX");
    expect(member.className).toBe("Hunter");
    
    const history = await service.history("123");
    expect(history).toHaveLength(2);
    expect(history.some(h => h.type === "name" && h.newValue === "PikoX")).toBe(true);
    expect(history.some(h => h.type === "class" && h.newValue === "Hunter")).toBe(true);
  });

  it("updates only name", async () => {
    const repo = new FakeRepo();
    const { service } = createServices(repo);
    await service.register({ discordId: "123", discordUsername: "user", characterName: "Piko", className: "Knight" });

    const { nameChanged, classChanged } = await service.updateNameAndClass({
      targetDiscordId: "123",
      newName: "PikoX",
      changedByDiscordId: "123"
    });

    expect(nameChanged).toBe(true);
    expect(classChanged).toBe(false);
    
    const history = await service.history("123");
    expect(history).toHaveLength(1);
    expect(history[0].type).toBe("name");
  });

  it("updates only class", async () => {
    const repo = new FakeRepo();
    const { service } = createServices(repo);
    await service.register({ discordId: "123", discordUsername: "user", characterName: "Piko", className: "Knight" });

    const { nameChanged, classChanged } = await service.updateNameAndClass({
      targetDiscordId: "123",
      newClass: "Hunter",
      changedByDiscordId: "123"
    });

    expect(nameChanged).toBe(false);
    expect(classChanged).toBe(true);
    
    const history = await service.history("123");
    expect(history).toHaveLength(1);
    expect(history[0].type).toBe("class");
  });

  it("handles same values gracefully (no change)", async () => {
    const repo = new FakeRepo();
    const { service } = createServices(repo);
    await service.register({ discordId: "123", discordUsername: "user", characterName: "Piko", className: "Knight" });

    const { nameChanged, classChanged } = await service.updateNameAndClass({
      targetDiscordId: "123",
      newName: "Piko",
      newClass: "Knight",
      changedByDiscordId: "123"
    });

    expect(nameChanged).toBe(false);
    expect(classChanged).toBe(false);
    expect(await service.history("123")).toHaveLength(0);
  });

  it("admin can update another member", async () => {
    const repo = new FakeRepo();
    const { service } = createServices(repo);
    await service.register({ discordId: "target", discordUsername: "target", characterName: "TargetPlayer", className: "Knight" });

    const { member } = await service.updateNameAndClass({
      targetDiscordId: "target",
      newName: "NewName",
      changedByDiscordId: "admin"
    });

    expect(member.characterName).toBe("NewName");
    const history = await service.history("target");
    expect(history[0].changedBy).toBe("admin");
  });

  it("rejects unregistered target", async () => {
    const repo = new FakeRepo();
    const { service } = createServices(repo);
    await expect(service.updateNameAndClass({
      targetDiscordId: "999",
      newName: "Test",
      changedByDiscordId: "admin"
    })).rejects.toThrow("This user is not registered.");
  });

  it("rejects invalid class", async () => {
    const repo = new FakeRepo();
    const { service } = createServices(repo);
    await service.register({ discordId: "123", discordUsername: "user", characterName: "Piko", className: "Knight" });

    await expect(service.updateNameAndClass({
      targetDiscordId: "123",
      newClass: "Ninja",
      changedByDiscordId: "123"
    })).rejects.toThrow("Invalid class");
  });

  it("rejects blank name", async () => {
    const repo = new FakeRepo();
    const { service } = createServices(repo);
    await service.register({ discordId: "123", discordUsername: "user", characterName: "Piko", className: "Knight" });

    await expect(service.updateNameAndClass({
      targetDiscordId: "123",
      newName: "  ",
      changedByDiscordId: "123"
    })).rejects.toThrow("Character name cannot be empty.");
  });

  it("allows Pending member to set blank name/class", async () => {
    const repo = new FakeRepo();
    const { service } = createServices(repo);
    // Simulate a pending member created by register_all (hypothetically)
    const pendingMember: Member = {
        memberId: "M000001",
        discordId: "123",
        discordUsername: "user",
        characterName: "",
        className: "",
        team: "",
        party: "",
        status: "Pending",
        joinedDate: "2026-01-01",
        lastUpdated: "2026-01-01"
    };
    repo.members.push(pendingMember);

    const { member } = await service.updateNameAndClass({
      targetDiscordId: "123",
      newName: "ActualName",
      newClass: "Wizard",
      changedByDiscordId: "123"
    });

    expect(member.characterName).toBe("ActualName");
    expect(member.className).toBe("Wizard");
    expect(member.status).toBe("Pending"); // Should not change status automatically
  });
});
