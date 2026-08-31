import { describe, expect, it } from "vitest";
import { ClassService } from "../src/services/class-service.js";
import type { MemberRepository } from "../src/repositories/member-repository.js";
import type { ClassConfig } from "../src/types/class.js";
import type { Member } from "../src/types/member.js";
import { hexToRgb } from "../src/utils/color.js";

class FakeMemberRepo implements Partial<MemberRepository> {
  configs: ClassConfig[] = [
    { classId: "1", className: "Knight", active: true, sortOrder: 1, symbol: "⚔️", colorHex: "#BCDBF9" },
    { classId: "2", className: "Priest", active: true, sortOrder: 2, symbol: "✝️", colorHex: "#AAEDEF" },
  ];

  async getClassConfigs() {
    return this.configs;
  }
}

describe("Class Presentation Logic", () => {
  it("resolves correct symbol and color for a class", async () => {
    const repo = new FakeMemberRepo();
    const service = new ClassService(repo as any);
    
    const presentation = await service.getClassPresentation("Priest");
    expect(presentation).not.toBeNull();
    expect(presentation?.symbol).toBe("✝️");
    expect(presentation?.colorHex).toBe("#AAEDEF");
  });

  it("formats player display correctly with symbol", async () => {
    const repo = new FakeMemberRepo();
    const service = new ClassService(repo as any);
    const member: Member = {
      characterName: "ATT-03",
      className: "Priest",
      discordId: "123",
      memberId: "M1",
      status: "Active"
    } as any;

    const display = await service.formatPlayerDisplay(member);
    expect(display.text).toBe("✝️ ATT-03");
    expect(display.symbol).toBe("✝️");
    expect(display.colorHex).toBe("#AAEDEF");
  });

  it("handles unknown class gracefully", async () => {
    const repo = new FakeMemberRepo();
    const service = new ClassService(repo as any);
    const member: Member = {
      characterName: "UnknownUser",
      className: "Hacker",
      discordId: "123",
      memberId: "M1",
      status: "Active"
    } as any;

    const display = await service.formatPlayerDisplay(member);
    expect(display.text).toBe("UnknownUser");
    expect(display.symbol).toBe("");
    expect(display.colorHex).toBeNull();
  });

  it("converts hex to RGB correctly", () => {
    const rgb = hexToRgb("#AAEDEF");
    expect(rgb).not.toBeNull();
    // AA = 170, ED = 237, EF = 239
    // 170/255 = 0.666, 237/255 = 0.929, 239/255 = 0.937
    expect(rgb?.red).toBeCloseTo(0.666, 2);
    expect(rgb?.green).toBeCloseTo(0.929, 2);
    expect(rgb?.blue).toBeCloseTo(0.937, 2);
  });
});
