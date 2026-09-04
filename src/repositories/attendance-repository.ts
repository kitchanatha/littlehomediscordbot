import type { AttendanceStatus, AttendanceResult } from "../types/attendance.js";

export interface AttendanceRepository {
  /**
   * Marks a member's attendance for "today" (the date column is resolved/created
   * automatically) on both the master attendance sheet and the member's class tab.
   */
  markAttendance(
    characterName: string,
    className: string,
    status: AttendanceStatus,
    at: Date
  ): Promise<AttendanceResult>;
  /**
   * Records a check-in for a Discord user who isn't registered yet — kept separate from the
   * player-facing attendance sheets (which should only ever show real character names) until
   * they register and it can be resolved into a real name. Deduped per discordId per calendar
   * day, so repeated voice joins/leaves the same day don't pile up entries.
   */
  recordPendingCheckIn(discordId: string, displayName: string, status: AttendanceStatus, at: Date): Promise<void>;
  /**
   * Reads and removes every pending check-in recorded for a Discord ID (call this once they
   * register, then replay each entry through markAttendance with their real name/class).
   */
  resolvePendingCheckIns(discordId: string): Promise<{ status: AttendanceStatus; at: Date }[]>;
  /**
   * Character names (normalizeName'd) already marked present ("มา") on the master attendance
   * sheet for "today" — used to build the admin check-in panel's "still needs checking in" list.
   */
  getPresentTodayNormalizedNames(at: Date): Promise<Set<string>>;
  /**
   * Mirrors a check-in/leave onto the separate "Little Home members" roster spreadsheet's
   * Members tab (a display snapshot, not part of this bot's own database). Silently skips (no
   * error) if the roster spreadsheet isn't configured or the character isn't found there. Callers
   * should still wrap this in try/catch — a Sheets API failure here should be logged and ignored,
   * never allowed to fail the real check-in this accompanies.
   */
  markRosterCheckin(characterName: string, status: AttendanceStatus, at: Date): Promise<void>;
  validateReadiness(): Promise<void>;
}
