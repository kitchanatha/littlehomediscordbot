import { describe, expect, it, vi } from "vitest";
import { AttendanceService } from "../src/services/attendance-service.js";
import { finalizePreviousWarDayIfDue } from "../src/services/war-finalizer.js";

const member = (name: string, joinedDate: string, status = "Active") =>
  ({ memberId: name, discordId: name, discordUsername: name, characterName: name, className: "Knight", team: "", party: "", status, joinedDate, lastUpdated: joinedDate }) as any;

describe("AttendanceService.finalizeWarDay", () => {
  it("marks only Active members who had joined by the end of that Bangkok day", async () => {
    const markAbsentForWarDay = vi.fn().mockResolvedValue({ master: 2, classTabs: 2 });
    const members = [
      member("early", "2026-09-06T13:00:00Z"),
      // Sun 4 Oct 23:30 Bangkok = 16:30Z the same day -> joined before the War ended.
      member("lateSameDay", "2026-10-04T16:30:00Z"),
      // Mon 5 Oct 00:30 Bangkok = Sun 17:30Z -> joined after the War ended.
      member("joinedAfter", "2026-10-04T17:30:00Z"),
    ];
    const service = new AttendanceService(
      { markAbsentForWarDay } as any,
      { getAllActiveMembers: async () => members } as any
    );

    const result = await service.finalizeWarDay({ year: 2026, month: 10, day: 4 });

    expect(markAbsentForWarDay).toHaveBeenCalledTimes(1);
    const [dayArg, listed] = markAbsentForWarDay.mock.calls[0];
    expect(listed.map((m: any) => m.characterName)).toEqual(["early", "lateSameDay"]);
    // The instant passed must resolve to Sunday 4 Oct in Bangkok, whatever the server timezone.
    expect(new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok" }).format(dayArg)).toBe("2026-10-04");
    expect(result).toEqual({ eligible: 2, master: 2, classTabs: 2 });
  });
});

describe("finalizePreviousWarDayIfDue", () => {
  const finalizer = () => ({ finalizeWarDay: vi.fn().mockResolvedValue({ eligible: 1, master: 1, classTabs: 1 }) });

  it("finalizes yesterday when it was a war day, once", async () => {
    const svc = finalizer();
    const done = new Set<string>();
    // Wed 7 Oct 00:10 Bangkok (= Tue 17:10Z): yesterday was Tuesday.
    const now = new Date("2026-10-06T17:10:00Z");
    expect(await finalizePreviousWarDayIfDue(svc, done, now)).toBe(true);
    expect(svc.finalizeWarDay).toHaveBeenCalledWith({ year: 2026, month: 10, day: 6 });
    expect(await finalizePreviousWarDayIfDue(svc, done, new Date("2026-10-07T05:00:00Z"))).toBe(false);
    expect(svc.finalizeWarDay).toHaveBeenCalledTimes(1);
  });

  it("does nothing when yesterday was not a war day", async () => {
    const svc = finalizer();
    // Tue 6 Oct 10:00 Bangkok: yesterday was Monday.
    expect(await finalizePreviousWarDayIfDue(svc, new Set(), new Date("2026-10-06T03:00:00Z"))).toBe(false);
    expect(svc.finalizeWarDay).not.toHaveBeenCalled();
  });

  it("never finalizes the day still in progress", async () => {
    const svc = finalizer();
    // Tue 6 Oct 23:50 Bangkok: today is a war day but not over; yesterday (Mon) is not a war day.
    expect(await finalizePreviousWarDayIfDue(svc, new Set(), new Date("2026-10-06T16:50:00Z"))).toBe(false);
  });

  it("is retried on the next tick if finalization fails", async () => {
    const svc = { finalizeWarDay: vi.fn().mockRejectedValueOnce(new Error("sheets down")).mockResolvedValue({ eligible: 0, master: 0, classTabs: 0 }) };
    const done = new Set<string>();
    const now = new Date("2026-10-06T17:10:00Z");
    await expect(finalizePreviousWarDayIfDue(svc, done, now)).rejects.toThrow("sheets down");
    expect(await finalizePreviousWarDayIfDue(svc, done, now)).toBe(true);
  });
});
