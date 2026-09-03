// Matches the values already used by hand in the guild's attendance sheets.
export type AttendanceStatus = "มา" | "แจ้งลาแล้ว";

export interface AttendanceResult {
  /** The War-date column label the mark was written under, e.g. "War 1/9/69". */
  dateLabel: string;
  /** Whether the master attendance sheet (เช็คขาด-ลา) was successfully updated. */
  markedMaster: boolean;
  /** Whether the member's class tab was successfully updated. */
  markedClassTab: boolean;
}
