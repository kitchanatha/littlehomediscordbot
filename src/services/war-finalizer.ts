import type { AttendanceService } from "./attendance-service.js";
import { isWarDay, previousBangkokDay } from "../utils/war-window.js";

const CHECK_EVERY_MS = 15 * 60 * 1000;
const FIRST_RUN_DELAY_MS = 30 * 1000;

const dayKey = (d: { year: number; month: number; day: number }) => `${d.year}-${d.month}-${d.day}`;

/**
 * If yesterday (Bangkok time) was a War day that hasn't been finalized by this process yet, marks
 * every member who neither checked in nor sent a leave as ขาด. Check-in closes at 23:59, so
 * "yesterday" is always a finished War. Running every 15 minutes for the whole of the next day
 * (rather than only at midnight) means a restart or outage around midnight still gets caught up;
 * finalizing twice is harmless because only blank cells are ever written.
 * Returns true if it ran a finalization.
 */
export async function finalizePreviousWarDayIfDue(
  service: Pick<AttendanceService, "finalizeWarDay">,
  done: Set<string>,
  now: Date = new Date()
): Promise<boolean> {
  const day = previousBangkokDay(now);
  if (!isWarDay(day) || done.has(dayKey(day))) return false;

  const result = await service.finalizeWarDay(day);
  done.add(dayKey(day));
  console.log(
    `INFO War ${day.day}/${day.month}/${day.year}: marked ขาด for ${result.master} member(s) on the master tab and ${result.classTabs} on class tabs (${result.eligible} eligible)`
  );
  return true;
}

export function startWarFinalizer(service: Pick<AttendanceService, "finalizeWarDay">): void {
  const done = new Set<string>();
  const tick = () =>
    finalizePreviousWarDayIfDue(service, done).catch((error) => {
      console.error("ERROR War day finalization failed (will retry)", error instanceof Error ? error.message : error);
    });
  setTimeout(tick, FIRST_RUN_DELAY_MS).unref();
  setInterval(tick, CHECK_EVERY_MS).unref();
}
