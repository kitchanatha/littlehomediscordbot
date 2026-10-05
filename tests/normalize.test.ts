import { describe, expect, it } from "vitest";
import { coreName, namesMatch, normalizeName } from "../src/utils/normalize.js";

describe("coreName", () => {
  it("strips Thai combining marks so decorated and plain spellings match", () => {
    // Real bug: these two differ only by a leading Thai vowel/tone mark, which the old
    // coreName didn't strip since it falls inside the ก-๙ range it otherwise keeps.
    expect(coreName("ิBellamie")).toBe(coreName("Bellamie"));
    expect(coreName("่judazz")).toBe(coreName("judazz"));
  });

  it("still distinguishes genuinely different names", () => {
    expect(coreName("Bellamie")).not.toBe(coreName("Claude"));
  });

  it("keeps names written only in Korean, kana or CJK instead of collapsing them to empty", () => {
    // Real bug: these all stripped to "" and so "matched" each other.
    expect(coreName("카오만뿌")).not.toBe("");
    expect(coreName("_キツネセルク_")).toBe(coreName("キツネセルク"));
    expect(coreName("貓女神の愛")).not.toBe("");
  });

  it("still ignores a leading decoration character on a Latin/Thai name", () => {
    expect(coreName("シคิววัดกลาง")).toBe(coreName("คิววัดกลาง"));
  });
});

describe("namesMatch", () => {
  it("matches decoration-only differences", () => {
    expect(namesMatch("ิBellamie", "Bellamie")).toBe(true);
    expect(namesMatch("่judazz", "judazz")).toBe(true);
  });

  it("matches a '/'-separated alt-name label against either name it contains", () => {
    expect(namesMatch("Amojoeee/NinjaRed-N-", "NinjaRed-N-")).toBe(true);
    expect(namesMatch("Amojoeee/NinjaRed-N-", "Amojoeee")).toBe(true);
    expect(namesMatch("NinjaRed-N-", "Amojoeee/NinjaRed-N-")).toBe(true);
  });

  it("does not treat different non-Latin/Thai names as the same name", () => {
    expect(namesMatch("카오만뿌", "キツネセルク")).toBe(false);
    expect(namesMatch("貓女神の愛", "_キツネセルク_")).toBe(false);
    expect(namesMatch("카오만뿌", "카오만뿌")).toBe(true);
  });

  it("never matches names that reduce to nothing at all (emoji/symbols only)", () => {
    expect(namesMatch("😀", "🎉")).toBe(false);
  });

  it("does not match unrelated names", () => {
    expect(namesMatch("Amojoeee/NinjaRed-N-", "Claude")).toBe(false);
    expect(namesMatch("Bellamie", "Bellamieee")).toBe(false);
  });
});

describe("normalizeName", () => {
  it("is case- and whitespace-insensitive", () => {
    expect(normalizeName("  Claude  ")).toBe(normalizeName("claude"));
  });
});
