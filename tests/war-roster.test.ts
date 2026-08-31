import { describe, expect, it, vi, beforeEach } from "vitest";
import { WarRosterService } from "../src/services/war-roster-service.js";

describe("WarRosterService", () => {
  let repository: any;
  let classService: any;
  let service: WarRosterService;

  beforeEach(() => {
    repository = {
      getAllActiveMembers: vi.fn(),
      findByDiscordId: vi.fn(),
    };
    classService = {
      formatPlayerDisplay: vi.fn().mockImplementation((m) => Promise.resolve({ text: m.characterName })),
    };
    service = new WarRosterService(repository, classService);
  });

  it("groups members correctly and sorts them", async () => {
    repository.getAllActiveMembers.mockResolvedValue([
      { characterName: "Piko", team: "A", party: "1", status: "Active" },
      { characterName: "Dino", team: "A", party: "1", status: "Active" },
      { characterName: "Taro", team: "B", party: "2", status: "Active" },
      { characterName: "Zoro", team: "A", party: "2", status: "Active" },
    ]);

    const roster = await service.getRoster();
    expect(roster.teams).toHaveLength(2);
    expect(roster.teams[0].team).toBe("A");
    expect(roster.teams[0].parties).toHaveLength(2);
    expect(roster.teams[0].parties[0].party).toBe(1);
    expect(roster.teams[0].parties[0].members).toEqual(["Dino", "Piko"]); // Sorted
    expect(roster.teams[0].parties[1].party).toBe(2);
    expect(roster.teams[0].parties[1].members).toEqual(["Zoro"]);
    expect(roster.teams[1].team).toBe("B");
    expect(roster.teams[1].parties[0].party).toBe(2);
    expect(roster.teams[1].parties[0].members).toEqual(["Taro"]);
  });

  it("filters by team", async () => {
    repository.getAllActiveMembers.mockResolvedValue([
      { characterName: "Piko", team: "A", party: "1", status: "Active" },
      { characterName: "Taro", team: "B", party: "2", status: "Active" },
    ]);

    const roster = await service.getRoster({ team: "A" });
    expect(roster.teams).toHaveLength(1);
    expect(roster.teams[0].team).toBe("A");
    expect(roster.teams[0].parties[0].members).toEqual(["Piko"]);
  });

  it("filters by team and party", async () => {
    repository.getAllActiveMembers.mockResolvedValue([
      { characterName: "Piko", team: "A", party: "1", status: "Active" },
      { characterName: "Dino", team: "A", party: "2", status: "Active" },
    ]);

    const roster = await service.getRoster({ team: "A", party: 1 });
    expect(roster.teams).toHaveLength(1);
    expect(roster.teams[0].parties).toHaveLength(1);
    expect(roster.teams[0].parties[0].party).toBe(1);
    expect(roster.teams[0].parties[0].members).toEqual(["Piko"]);
  });

  it("ignores invalid teams and parties", async () => {
     repository.getAllActiveMembers.mockResolvedValue([
      { characterName: "Invalid", team: "D", party: "1", status: "Active" },
      { characterName: "NoParty", team: "A", party: "", status: "Active" },
      { characterName: "ZeroParty", team: "B", party: "0", status: "Active" },
    ]);

    const roster = await service.getRoster();
    expect(roster.teams).toHaveLength(0);
  });

  it("verifies user registration", async () => {
    repository.findByDiscordId.mockResolvedValueOnce({ memberId: "M1" }).mockResolvedValueOnce(null);
    
    expect(await service.isUserRegistered("user1")).toBe(true);
    expect(await service.isUserRegistered("user2")).toBe(false);
  });
});
