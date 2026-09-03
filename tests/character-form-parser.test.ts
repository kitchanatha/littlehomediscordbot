import { describe, expect, it } from "vitest";
import { parseCharacterForm, resolveClassName } from "../src/utils/character-form-parser.js";

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

describe("parseCharacterForm", () => {
  it("extracts character name and class from the guild's form template", () => {
    const content = [
      "ชื่อในเกมส์ : หมาคง",
      "ชื่อเล่น : แชมป์",
      "อาชีพ : พระ",
      "เพศ : ชาย",
      "อายุ : 28",
    ].join("\n");

    expect(parseCharacterForm(content)).toEqual({ characterName: "หมาคง", rawClass: "พระ" });
  });

  it("returns nulls when the message doesn't match the form", () => {
    expect(parseCharacterForm("hey everyone, excited to join!")).toEqual({
      characterName: null,
      rawClass: null,
    });
  });

  it("tolerates a full-width colon and extra spacing", () => {
    const content = "ชื่อในเกมส์：  หมาคง  \nอาชีพ：ม้อง";
    expect(parseCharacterForm(content)).toEqual({ characterName: "หมาคง", rawClass: "ม้อง" });
  });

  it("accepts the more common ชื่อในเกม (no ส์) and คลาส labels", () => {
    const content = [
      "ชื่อในเกม : METALEX",
      "ชื่อเล่น : เม้ง",
      "คลาส : Priest",
      "เพศ : ชาย",
      "อายุ : 38",
    ].join("\n");

    expect(parseCharacterForm(content)).toEqual({ characterName: "METALEX", rawClass: "Priest" });
  });

  it("does not confuse ชื่อเล่น (nickname) with the character name", () => {
    const content = "ชื่อเล่น : เม้ง\nชื่อในเกม : METALEX\nคลาส : Priest";
    expect(parseCharacterForm(content).characterName).toBe("METALEX");
  });
});

describe("resolveClassName", () => {
  it("resolves known Thai slang terms", () => {
    expect(resolveClassName("ม้อง", ACTIVE_CLASSES)).toBe("Monk");
    expect(resolveClassName("อัศวิน", ACTIVE_CLASSES)).toBe("Knight");
  });

  it("resolves any พระ-prefixed term to Priest", () => {
    expect(resolveClassName("พระ", ACTIVE_CLASSES)).toBe("Priest");
    expect(resolveClassName("พระว้าย", ACTIVE_CLASSES)).toBe("Priest");
  });

  it("falls back to a direct English class name, case-insensitively", () => {
    expect(resolveClassName("priest", ACTIVE_CLASSES)).toBe("Priest");
    expect(resolveClassName("Hunter", ACTIVE_CLASSES)).toBe("Hunter");
  });

  it("tolerates inconsistent spacing in an English class name", () => {
    expect(resolveClassName("Black Smith", ACTIVE_CLASSES)).toBe("Blacksmith");
  });

  it("resolves ไนท์ (Thai transliteration) to Knight", () => {
    expect(resolveClassName("ไนท์", ACTIVE_CLASSES)).toBe("Knight");
  });

  it("returns null for unrecognized input", () => {
    expect(resolveClassName("นักเวทมนตร์อลังการ", ACTIVE_CLASSES)).toBeNull();
    expect(resolveClassName("", ACTIVE_CLASSES)).toBeNull();
  });
});
