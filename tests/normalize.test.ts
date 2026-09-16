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
