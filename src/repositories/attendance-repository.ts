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
  validateReadiness(): Promise<void>;
}
