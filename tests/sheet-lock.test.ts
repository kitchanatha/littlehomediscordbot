import { describe, expect, it } from "vitest";
import { withSheetDeleteLock } from "../src/utils/sheet-lock.js";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Models the real hazard: delete-by-index against a shared "sheet". Each operation reads the
// index, yields (like an API round trip), then deletes by that index.
async function deleteByIndex(sheet: string[], id: string): Promise<void> {
  const idx = sheet.indexOf(id);
  await sleep(5);
  if (idx >= 0) sheet.splice(idx, 1);
}

describe("withSheetDeleteLock", () => {
  it("without the lock, concurrent delete-by-index removes the wrong rows (the bug)", async () => {
    const sheet = ["a", "b", "c", "d", "e"];
    await Promise.all([deleteByIndex(sheet, "b"), deleteByIndex(sheet, "d")]);
    expect(sheet).not.toEqual(["a", "c", "e"]); // "d"'s stale index removed "e" instead
  });

  it("with the lock, concurrent deletes remove exactly the intended rows", async () => {
    const sheet = ["a", "b", "c", "d", "e"];
    await Promise.all([
      withSheetDeleteLock(() => deleteByIndex(sheet, "b")),
      withSheetDeleteLock(() => deleteByIndex(sheet, "d")),
    ]);
    expect(sheet).toEqual(["a", "c", "e"]);
  });

  it("keeps the queue moving after a failing section", async () => {
    await expect(withSheetDeleteLock(async () => { throw new Error("boom"); })).rejects.toThrow("boom");
    await expect(withSheetDeleteLock(async () => 42)).resolves.toBe(42);
  });
});
