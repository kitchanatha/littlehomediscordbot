import { describe, expect, it } from "vitest";
import type { MemberRepository } from "../src/repositories/member-repository.js";
import { MemberService, UserError } from "../src/services/member-service.js";
import type { HistoryEntry, LegacyMember, Member } from "../src/types/member.js";
import { normalizeName } from "../src/utils/normalize.js";

class FakeRepo implements MemberRepository {
  members: Member[] = [];
  history: HistoryEntry[] = [];
  legacy: LegacyMember | null = { legacyName: "Piko", className: "Knight", team: "A", party: "8", source: "legacy", matchStatus: "Matched", notes: "" };
  classes = ["Knight", "Hunter", "Priest"];

  async findByDiscordId(discordId: string) { return this.members.find(m => m.discordId === discordId) || null; }
  async findLegacyByName(name: string) { return normalizeName(name) === normalizeName(this.legacy?.legacyName || "") ? this.legacy : null; }
  async getActiveClasses() { return this.classes; }
  async getClassConfigs() {
    return this.classes.map((c, i) => ({
      classId: String(i),
      className: c,
      active: true,
      sortOrder: i,
      symbol: "S",
      colorHex: "#000000"
    }));
  }
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
  async getHistory(memberId: string) { return this.history.filter(h => h.memberId === memberId); }
  async getAllMemberIds() { return this.members.map(m => m.memberId); }
  async getAllHistoryIds() { return this.history.map(h => h.historyId); }
  async linkLegacy(legacyName: string, discordId: string, memberId: string, linkedAt: string) {
    if (this.legacy && normalizeName(this.legacy.legacyName) === normalizeName(legacyName)) {
      this.legacy.linkedDiscordId = discordId;
      this.legacy.linkedMemberId = memberId;
      this.legacy.linkedAt = linkedAt;
    }
  }
  async getAllActiveMembers() { return this.members.filter(m => m.status.toLowerCase() === "active"); }
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
  async updateTeamAndParty(m: Member, updates: { team?: string; party?: string }, histories: HistoryEntry[], audit: any) {
    this.history.push(...histories);
    const index = this.members.findIndex(member => member.memberId === m.memberId);
    this.members[index] = { 
      ...m, 
      team: updates.team ?? m.team, 
      party: updates.party ?? m.party, 
      lastUpdated: histories[0]?.changedAt || m.lastUpdated 
    };
    return this.members[index];
  }
  async validateReadiness() {}
}

describe("MemberService", () => {
  const createServices = (repo: MemberRepository) => {
    const classService: any = {
      getActiveClasses: () => Promise.resolve(["Knight", "Hunter", "Priest"]),
      formatPlayerDisplay: (m: Member) => Promise.resolve({ text: m.characterName }),
      getClassPresentation: () => Promise.resolve({ className: "Knight", symbol: "K", colorHex: "#000" }),
    };
    const displayService: any = {
      refreshAllMemberDisplays: () => Promise.resolve(),
    };
    const service = new MemberService(repo, classService, displayService);
    return { service, classService, displayService };
  };

  it("registers a new legacy member and links team/party", async () => {
    const repo = new FakeRepo();
    const { service } = createServices(repo);
    const result = await service.register({ discordId: "123", discordUsername: "user", characterName: "Piko", className: "Knight" });
    
    expect(result.legacyLinked).toBe(true);
    expect(result.member.memberId).toBe("M000001");
    expect(result.member.className).toBe("Knight");
    expect(result.member.team).toBe("A");
    expect(result.member.party).toBe("8");
  });

  it("registers a new non-legacy member", async () => {
    const repo = new FakeRepo();
    const { service } = createServices(repo);
    const result = await service.register({ discordId: "456", discordUsername: "newbie", characterName: "NewGuy", className: "Hunter" });
    
    expect(result.legacyLinked).toBe(false);
    expect(result.member.memberId).toBe("M000001");
    expect(result.member.characterName).toBe("NewGuy");
    expect(result.member.className).toBe("Hunter");
    expect(result.member.team).toBe("");
    expect(result.member.party).toBe("");
  });

  it("rejects duplicate registration with name_class message", async () => {
    const repo = new FakeRepo();
    const { service } = createServices(repo);
    await service.register({ discordId: "123", discordUsername: "user", characterName: "Piko", className: "Knight" });
    await expect(service.register({ discordId: "123", discordUsername: "user", characterName: "Piko", className: "Knight" }))
      .rejects.toThrow("/name_class");
  });

  it("validates class against active classes", async () => {
    const repo = new FakeRepo();
    const { service } = createServices(repo);
    await expect(service.register({ discordId: "123", discordUsername: "user", characterName: "NewGuy", className: "Ninja" }))
      .rejects.toThrow("Invalid class");
  });

  it("legacy class does not override selected class", async () => {
    const repo = new FakeRepo();
    const { service } = createServices(repo);
    const result = await service.register({ discordId: "123", discordUsername: "user", characterName: "Piko", className: "Hunter" });
    
    expect(result.member.className).toBe("Hunter");
    expect(result.member.team).toBe("A");
  });

  it("registration creates no history", async () => {
    const repo = new FakeRepo();
    const { service } = createServices(repo);
    await service.register({ discordId: "123", discordUsername: "user", characterName: "Piko", className: "Knight" });
    
    expect(repo.history.length).toBe(0);
  });

  it("changes name and creates Name_History", async () => {
    const repo = new FakeRepo();
    const { service } = createServices(repo);
    await service.register({ discordId: "123", discordUsername: "user", characterName: "Piko", className: "Knight" });
    
    const updated = await service.changeName("123", "PikoX");
    expect(updated.characterName).toBe("PikoX");
    
    const history = await service.history("123");
    expect(history).toHaveLength(1);
    expect(history[0].type).toBe("name");
    expect(history[0].oldValue).toBe("Piko");
    expect(history[0].newValue).toBe("PikoX");
    expect(history[0].historyId).toBe("H000001");
  });

  it("changes class and creates Class_History", async () => {
    const repo = new FakeRepo();
    const { service } = createServices(repo);
    await service.register({ discordId: "123", discordUsername: "user", characterName: "Piko", className: "Knight" });
    
    const updated = await service.changeClass("123", "Hunter");
    expect(updated.className).toBe("Hunter");
    
    const history = await service.history("123");
    expect(history).toHaveLength(1);
    expect(history[0].type).toBe("class");
    expect(history[0].oldValue).toBe("Knight");
    expect(history[0].newValue).toBe("Hunter");
  });

  it("profile lookup uses Discord ID", async () => {
    const repo = new FakeRepo();
    const { service } = createServices(repo);
    await service.register({ discordId: "123", discordUsername: "user", characterName: "Piko", className: "Knight" });
    
    const profile = await service.profile("123");
    expect(profile.characterName).toBe("Piko");
    
    await expect(service.profile("999")).rejects.toThrow("You are not registered");
  });

  it("history returns both history types", async () => {
    const repo = new FakeRepo();
    const { service } = createServices(repo);
    await service.register({ discordId: "123", discordUsername: "user", characterName: "Piko", className: "Knight" });
    
    await service.changeName("123", "PikoX");
    await service.changeClass("123", "Hunter");
    
    const history = await service.history("123");
    expect(history).toHaveLength(2);
    expect(history.map(h => h.type)).toContain("name");
    expect(history.map(h => h.type)).toContain("class");
  });

  it("normalization uses Unicode NFKC + trim + case-insensitive matching", () => {
    const input1 = "  Ｐｉｋｏ  "; // Full-width characters
    const input2 = "piko";
    expect(normalizeName(input1)).toBe(normalizeName(input2));
  });

  it("first legacy claim succeeds and links discord id", async () => {
    const repo = new FakeRepo();
    const { service } = createServices(repo);
    await service.register({ discordId: "123", discordUsername: "user", characterName: "Piko", className: "Knight" });
    
    expect(repo.legacy?.linkedDiscordId).toBe("123");
  });

  it("prevents duplicate legacy claims by different discord accounts", async () => {
    const repo = new FakeRepo();
    const { service } = createServices(repo);
    // User 1 claims Piko
    await service.register({ discordId: "123", discordUsername: "user1", characterName: "Piko", className: "Knight" });
    
    // User 2 tries to claim Piko
    await expect(service.register({ discordId: "456", discordUsername: "user2", characterName: "Piko", className: "Knight" }))
      .rejects.toThrow("already been claimed by another user");
  });

  it("handles legacy registration when legacy class is blank and user provides one", async () => {
    const repo = new FakeRepo();
    repo.legacy = { legacyName: "NoClassPiko", className: "", team: "B", party: "2", source: "legacy", matchStatus: "Matched", notes: "" };
    const { service } = createServices(repo);
    
    const result = await service.register({ discordId: "123", discordUsername: "user", characterName: "NoClassPiko", className: "Priest" });
    
    expect(result.member.className).toBe("Priest");
    expect(result.member.team).toBe("B");
    expect(result.member.party).toBe("2");
  });

  it("rejects legacy registration when user class is invalid", async () => {
    const repo = new FakeRepo();
    repo.legacy = { legacyName: "NoClassPiko", className: "", team: "B", party: "2", source: "legacy", matchStatus: "Matched", notes: "" };
    const { service } = createServices(repo);
    
    await expect(service.register({ discordId: "123", discordUsername: "user", characterName: "NoClassPiko", className: "Invalid" }))
      .rejects.toThrow("Invalid class");
  });

  describe("assignMember", () => {
    it("assigns team and party to a registered member", async () => {
      const repo = new FakeRepo();
      const { service } = createServices(repo);
      await service.register({ discordId: "123", discordUsername: "user", characterName: "Piko", className: "Knight" });
      
      const updated = await service.assignMember({
        targetDiscordId: "123",
        team: "C",
        party: 4,
        adminDiscordId: "admin1",
      });
      
      expect(updated.team).toBe("C");
      expect(updated.party).toBe("4");
      
      const history = await service.history("123");
      expect(history.filter(h => h.type === "team")).toHaveLength(1);
      expect(history.filter(h => h.type === "party")).toHaveLength(1);
    });

    it("rejects unregistered member", async () => {
      const repo = new FakeRepo();
      const { service } = createServices(repo);
      await expect(service.assignMember({ targetDiscordId: "999", team: "A", party: 1, adminDiscordId: "admin" }))
        .rejects.toThrow("not registered");
    });

    it("validates team (A, B, or C)", async () => {
      const repo = new FakeRepo();
      const { service } = createServices(repo);
      await service.register({ discordId: "123", discordUsername: "user", characterName: "Piko", className: "Knight" });
      await expect(service.assignMember({ targetDiscordId: "123", team: "D", party: 1, adminDiscordId: "admin" }))
        .rejects.toThrow("Invalid team");
    });

    it("validates party as positive integer", async () => {
      const repo = new FakeRepo();
      const { service } = createServices(repo);
      await service.register({ discordId: "123", discordUsername: "user", characterName: "Piko", className: "Knight" });
      await expect(service.assignMember({ targetDiscordId: "123", team: "A", party: 0, adminDiscordId: "admin" }))
        .rejects.toThrow("positive integer");
      await expect(service.assignMember({ targetDiscordId: "123", team: "A", party: -1, adminDiscordId: "admin" }))
        .rejects.toThrow("positive integer");
    });

    it("does not create history if value is the same", async () => {
      const repo = new FakeRepo();
      const { service } = createServices(repo);
      await service.register({ discordId: "123", discordUsername: "user", characterName: "Piko", className: "Knight" });
      // Legacy Piko is Team A, Party 8
      
      // Assign Team A (no change) but change Party to 1
      const updated = await service.assignMember({ targetDiscordId: "123", team: "A", party: 1, adminDiscordId: "admin" });
      expect(updated.team).toBe("A");
      expect(updated.party).toBe("1");
      
      const history = await service.history("123");
      expect(history.filter(h => h.type === "team")).toHaveLength(0);
      expect(history.filter(h => h.type === "party")).toHaveLength(1);
    });

    it("rejects if no change at all", async () => {
      const repo = new FakeRepo();
      const { service } = createServices(repo);
      await service.register({ discordId: "123", discordUsername: "user", characterName: "Piko", className: "Knight" });
      
      await expect(service.assignMember({ targetDiscordId: "123", team: "A", party: 8, adminDiscordId: "admin" }))
        .rejects.toThrow("already assigned");
    });

    it("history command shows all types", async () => {
      const repo = new FakeRepo();
      const { service } = createServices(repo);
      await service.register({ discordId: "123", discordUsername: "user", characterName: "Piko", className: "Knight" });
      await service.changeName("123", "PikoX");
      await service.changeClass("123", "Hunter");
      await service.assignMember({ targetDiscordId: "123", team: "C", party: 4, adminDiscordId: "admin" });
      
      const history = await service.history("123");
      expect(history).toHaveLength(4);
      const types = history.map(h => h.type);
      expect(types).toContain("name");
      expect(types).toContain("class");
      expect(types).toContain("team");
      expect(types).toContain("party");
    });
  });

  describe("bulkRegister", () => {
    it("registers multiple members with Pending status and blank fields", async () => {
      const repo = new FakeRepo();
      const { service } = createServices(repo);
      
      const users = [
        { discordId: "101", discordUsername: "User1" },
        { discordId: "102", discordUsername: "User2" },
      ];
      
      const result = await service.bulkRegister(users);
      expect(result.registeredCount).toBe(2);
      
      const m1 = await service.profile("101");
      expect(m1.status).toBe("Pending");
      expect(m1.characterName).toBe("");
      expect(m1.memberId).toBe("M000001");
      
      const m2 = await service.profile("102");
      expect(m2.memberId).toBe("M000002");
    });

    it("skips already registered members", async () => {
      const repo = new FakeRepo();
      const { service } = createServices(repo);
      await service.register({ discordId: "101", discordUsername: "User1", characterName: "Test", className: "Hunter" });
      
      const users = [
        { discordId: "101", discordUsername: "User1" },
        { discordId: "102", discordUsername: "User2" },
      ];
      
      const result = await service.bulkRegister(users);
      expect(result.registeredCount).toBe(1);
      expect(result.skippedCount).toBe(1);
    });
  });
});
