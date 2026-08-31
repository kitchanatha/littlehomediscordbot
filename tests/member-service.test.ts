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
}

describe("MemberService", () => {
  it("registers a new legacy member and links team/party", async () => {
    const repo = new FakeRepo();
    const service = new MemberService(repo);
    const result = await service.register({ discordId: "123", discordUsername: "user", characterName: "Piko" });
    
    expect(result.legacyLinked).toBe(true);
    expect(result.member.memberId).toBe("M000001");
    expect(result.member.className).toBe("Knight");
    expect(result.member.team).toBe("A");
    expect(result.member.party).toBe("8");
  });

  it("registers a new non-legacy member", async () => {
    const repo = new FakeRepo();
    const service = new MemberService(repo);
    const result = await service.register({ discordId: "456", discordUsername: "newbie", characterName: "NewGuy", className: "Hunter" });
    
    expect(result.legacyLinked).toBe(false);
    expect(result.member.memberId).toBe("M000001");
    expect(result.member.characterName).toBe("NewGuy");
    expect(result.member.className).toBe("Hunter");
    expect(result.member.team).toBe("");
    expect(result.member.party).toBe("");
  });

  it("rejects duplicate registration", async () => {
    const repo = new FakeRepo();
    const service = new MemberService(repo);
    await service.register({ discordId: "123", discordUsername: "user", characterName: "Piko" });
    await expect(service.register({ discordId: "123", discordUsername: "user", characterName: "Piko" }))
      .rejects.toThrow("You are already registered");
  });

  it("validates class against active classes", async () => {
    const repo = new FakeRepo();
    const service = new MemberService(repo);
    await expect(service.register({ discordId: "123", discordUsername: "user", characterName: "NewGuy", className: "Ninja" }))
      .rejects.toThrow("Invalid class");
  });

  it("prefers legacy class and reports conflict", async () => {
    const repo = new FakeRepo();
    const service = new MemberService(repo);
    const result = await service.register({ discordId: "123", discordUsername: "user", characterName: "Piko", className: "Hunter" });
    
    expect(result.member.className).toBe("Knight"); // Legacy class
    expect(result.classOverridden).toBe(true);
  });

  it("changes name and creates Name_History", async () => {
    const repo = new FakeRepo();
    const service = new MemberService(repo);
    await service.register({ discordId: "123", discordUsername: "user", characterName: "Piko" });
    
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
    const service = new MemberService(repo);
    await service.register({ discordId: "123", discordUsername: "user", characterName: "Piko" });
    
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
    const service = new MemberService(repo);
    await service.register({ discordId: "123", discordUsername: "user", characterName: "Piko" });
    
    const profile = await service.profile("123");
    expect(profile.characterName).toBe("Piko");
    
    await expect(service.profile("999")).rejects.toThrow("You are not registered");
  });

  it("history returns both history types", async () => {
    const repo = new FakeRepo();
    const service = new MemberService(repo);
    await service.register({ discordId: "123", discordUsername: "user", characterName: "Piko" });
    
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
});
