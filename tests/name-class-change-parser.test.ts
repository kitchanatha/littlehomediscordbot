import { describe, expect, it } from "vitest";
import { parseNameClassChange } from "../src/utils/name-class-change-parser.js";

const ACTIVE_CLASSES = [
  "Knight",
  "Paladin",
  "Hunter",
  "Assassin",
  "Wizard",
  "Priest",
  "Monk",
  "Blacksmith",
  "Gunslinger",
  "Druid",
];

describe("parseNameClassChange", () => {
  it("returns nulls for unrelated chat", () => {
    expect(parseNameClassChange("gg guys nice war today", ACTIVE_CLASSES)).toEqual({
      newName: null,
      newClass: null,
      unresolvedClass: null,
      ambiguousMultipleTargets: false,
    });
  });

  it("parses a name change with the เปลี่ยนชื่อ header", () => {
    const result = parseNameClassChange("เปลี่ยนชื่อ MilinX >> น้อนมิลิน", ACTIVE_CLASSES);
    expect(result.newName).toBe("น้อนมิลิน");
    expect(result.newClass).toBeNull();
  });

  it("parses a class change with the เปลี่ยนอาชีพ header", () => {
    const result = parseNameClassChange("เปลี่ยนอาชีพ Druid >>> Wizard", ACTIVE_CLASSES);
    expect(result.newClass).toBe("Wizard");
    expect(result.newName).toBeNull();
  });

  it("classifies by content when there's no header (class case)", () => {
    const result = parseNameClassChange("Priest >> Wizard", ACTIVE_CLASSES);
    expect(result.newClass).toBe("Wizard");
    expect(result.newName).toBeNull();
  });

  it("classifies by content when there's no header (name case)", () => {
    const result = parseNameClassChange("PS5 >>> สนธยา", ACTIVE_CLASSES);
    expect(result.newName).toBe("สนธยา");
    expect(result.newClass).toBeNull();
  });

  it("parses the เปลี่ยนจาก...มาเป็น phrasing", () => {
    const result = parseNameClassChange("เปลี่ยนจากพระ มาเป็น แชมป์เปี้ยน", ACTIVE_CLASSES);
    expect(result.newClass).toBe("Monk");
  });

  it("picks up both a name change and a class change in the same message", () => {
    const content = "H??!YAI >> H!Y_Rainstorm\nWhitesmith >> Assassin Cross";
    const result = parseNameClassChange(content, ACTIVE_CLASSES);
    expect(result.newName).toBe("H!Y_Rainstorm");
    // "Assassin Cross" is Assassin's advanced job — resolves via the alias map, still
    // correctly split from the name-change line.
    expect(result.newClass).toBe("Assassin");
  });

  it("picks up both an explicitly-headered name change and class change together", () => {
    const content = "เปลี่ยนชื่อ KungNew >> น้อนนิว\nเปลี่ยนอาชีพ Lord Knight >>> Paladin";
    const result = parseNameClassChange(content, ACTIVE_CLASSES);
    expect(result.newName).toBe("น้อนนิว");
    expect(result.newClass).toBe("Paladin");
  });

  it("flags multiple name-change targets as ambiguous instead of guessing", () => {
    const content = [
      "เปลี่ยนชื่อ",
      "ShogunS >> เสาหลักรีเจนซี่",
      "ต้มยำน้ำข้น >> เสาหลักมิดไนท์",
    ].join("\n");
    const result = parseNameClassChange(content, ACTIVE_CLASSES);
    expect(result.ambiguousMultipleTargets).toBe(true);
    expect(result.newName).toBeNull();
  });

  it("resolves Night Walker to Gunslinger (confirmed by the guild)", () => {
    const result = parseNameClassChange("เปลี่ยนอาชีพ Hunter >>> Night Walker", ACTIVE_CLASSES);
    expect(result.newClass).toBe("Gunslinger");
  });

  it("reports a genuinely unresolved class attempt without guessing", () => {
    const result = parseNameClassChange("เปลี่ยนอาชีพ\nมือปืน>>>>> นักดาบ", ACTIVE_CLASSES);
    expect(result.newClass).toBeNull();
    expect(result.unresolvedClass).toBe("นักดาบ");
  });
});
