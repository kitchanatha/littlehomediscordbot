// Every row delete in the bot is "read the sheet, find the row index, delete that index". Deleting
// a row shifts every row below it, so if two such operations interleave (e.g. several
// GuildMemberRemove events arriving at once) the second one deletes using an index that went
// stale after the first — and removes whichever unrelated row slid into that slot. This lock
// serialises those read-then-delete sections process-wide so each one sees a settled sheet.
//
// It is NOT re-entrant: wrap only a self-contained read+delete section, never one that calls
// another locked section.
let tail: Promise<void> = Promise.resolve();

export function withSheetDeleteLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = tail.then(fn, fn);
  tail = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}
