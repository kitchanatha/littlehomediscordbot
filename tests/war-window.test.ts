import { describe, expect, it } from "vitest";
import { isWarCheckInOpen } from "../src/utils/war-window.js";

// Bangkok is UTC+7, so 05:00 Bangkok = 22:00 UTC the previous day.
// 2026-10-06 is a Tuesday, 10-07 Wednesday, 10-08 Thursday, 10-11 Sunday, 10-12 Monday.
describe("isWarCheckInOpen", () => {
  it("is closed before 05:00 on a war day and opens at 05:00 Bangkok time", () => {
    expect(isWarCheckInOpen(new Date("2026-10-05T21:59:00Z"))).toBe(false); // Tue 04:59
    expect(isWarCheckInOpen(new Date("2026-10-05T22:00:00Z"))).toBe(true); // Tue 05:00
  });

  it("stays open through 23:59 and closes at midnight", () => {
    expect(isWarCheckInOpen(new Date("2026-10-06T16:59:00Z"))).toBe(true); // Tue 23:59
    expect(isWarCheckInOpen(new Date("2026-10-06T17:00:00Z"))).toBe(false); // Wed 00:00
  });

  it("is open on Tuesday, Thursday and Sunday", () => {
    expect(isWarCheckInOpen(new Date("2026-10-06T08:00:00Z"))).toBe(true); // Tue 15:00
    expect(isWarCheckInOpen(new Date("2026-10-08T08:00:00Z"))).toBe(true); // Thu 15:00
    expect(isWarCheckInOpen(new Date("2026-10-11T08:00:00Z"))).toBe(true); // Sun 15:00
  });

  it("is closed on every other weekday, even in the afternoon", () => {
    expect(isWarCheckInOpen(new Date("2026-10-07T08:00:00Z"))).toBe(false); // Wed
    expect(isWarCheckInOpen(new Date("2026-10-09T08:00:00Z"))).toBe(false); // Fri
    expect(isWarCheckInOpen(new Date("2026-10-10T08:00:00Z"))).toBe(false); // Sat
    expect(isWarCheckInOpen(new Date("2026-10-12T08:00:00Z"))).toBe(false); // Mon
  });

  it("uses Bangkok time, not UTC, for the weekday boundary", () => {
    // Tue 23:30 UTC is already Wednesday 06:30 in Bangkok -> closed.
    expect(isWarCheckInOpen(new Date("2026-10-06T23:30:00Z"))).toBe(false);
    // Mon 23:30 UTC is Tuesday 06:30 in Bangkok -> open.
    expect(isWarCheckInOpen(new Date("2026-10-05T23:30:00Z"))).toBe(true);
  });
});
