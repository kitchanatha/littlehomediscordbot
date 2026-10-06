import { describe, expect, it, vi } from "vitest";
import { findRosterCells, rosterNameRows, a1 } from "../src/utils/war-roster-cells.js";
import { AttendanceService } from "../src/services/attendance-service.js";

const hdr = ["1", "2", "3", "4", "5", "6", "7", "8"];
// Mirrors the real tabs: title row, header row, five name rows, blank row, next block.
const grid: string[][] = [
  ["Team A"],
  hdr,
  ["PANDA", "Backnumber", "โม๊ค", "อูกิ๊ส์"],
  ["MuMoggy", "ไก่จ๊วบแซ่จิ๊บ", "โนว่า"],
  ["PuRin", "", "ไอดีพัง"],
  ["a", "b"],
  ["c"],
  [],
  ["Team ฟา [ Fariszme ]"],
  hdr,
  ["Fariszme", "ไก่จ๊วบแซ่จุ๊บ"],
  ["ไอดีพัง"],
  [],
  [],
  [],
  [],
  ["Team ตีบอส"],
  ["1", "", "2"],
  ["ยำโพ", "", "Humlek"],
];

describe("rosterNameRows", () => {
  it("returns only the rows under each 1…8 header (including the ตีบอส '1 _ 2' header)", () => {
    expect(rosterNameRows(grid)).toEqual([2, 3, 4, 5, 6, 10, 11, 12, 13, 14, 18]);
  });
});

describe("findRosterCells", () => {
  const none = new Set<string>();

  it("finds every occurrence of an exact name, ignoring case, in name rows only", () => {
    const cells = findRosterCells(grid, "ไอดีพัง", none);
    expect(cells.map((c) => a1("ปาร์ตี้", c))).toEqual(["ปาร์ตี้!C5", "ปาร์ตี้!A12"]);
  });

  it("never matches a title or header cell that merely contains the name", () => {
    expect(findRosterCells(grid, "Fariszme", none).map((c) => a1("x", c))).toEqual(["x!A11"]); // not the A9 title
  });

  it("does not clear a different member whose name only loosely matches", () => {
    // ไก่จ๊วบแซ่จุ๊บ is looser-equal to ไก่จ๊วบแซ่จิ๊บ; with both registered, leaving one must not touch the other.
    const others = new Set(["ไก่จ๊วบแซ่จุ๊บ"]);
    expect(findRosterCells(grid, "ไก่จ๊วบแซ่จิ๊บ", others).map((c) => a1("x", c))).toEqual(["x!B4"]);
    expect(findRosterCells(grid, "ไก่จ๊วบแซ่จุ๊บ", new Set(["ไก่จ๊วบแซ่จิ๊บ"])).map((c) => a1("x", c))).toEqual(["x!B11"]);
  });

  it("falls back to a loose match only when there is no exact one and the cell is nobody else's name", () => {
    expect(findRosterCells(grid, "Humlek ", none).map((c) => a1("x", c))).toEqual(["x!C19"]); // exact after trim
    expect(findRosterCells([hdr, ["พระซิ่ง"]], "พระซิง", none)).toHaveLength(1); // tone/vowel drift, unique
    expect(findRosterCells([hdr, ["พระซิ่ง"]], "พระซิง", new Set(["พระซิ่ง"]))).toHaveLength(0); // that cell belongs to someone else
  });

  it("skips formula cells", () => {
    expect(findRosterCells([hdr, ["=FILTER(A:A)"]], "=FILTER(A:A)", none)).toHaveLength(0);
  });
});

describe("AttendanceService.requestLeave", () => {
  const member = { memberId: "M1", discordId: "d1", characterName: "ไอดีพัง", className: "Bard", status: "Active" } as any;
  const make = (removeImpl: () => Promise<number>) => {
    const markAttendance = vi.fn().mockResolvedValue({ dateLabel: "War 6/10/69", markedMaster: true, markedClassTab: true });
    const removeFromWarRosters = vi.fn(removeImpl);
    const service = new AttendanceService(
      { markAttendance, markRosterCheckin: vi.fn() } as any,
      { findByDiscordId: async () => member, removeFromWarRosters } as any
    );
    return { service, markAttendance, removeFromWarRosters };
  };

  it("marks the leave and clears the member from the war planning tabs", async () => {
    const { service, markAttendance, removeFromWarRosters } = make(async () => 2);
    const res = await service.requestLeave("d1");
    expect(markAttendance).toHaveBeenCalledWith("ไอดีพัง", "Bard", "แจ้งลาแล้ว", expect.any(Date));
    expect(removeFromWarRosters).toHaveBeenCalledWith("ไอดีพัง");
    expect(res).toEqual({ characterName: "ไอดีพัง", dateLabel: "War 6/10/69" });
  });

  it("still succeeds when clearing the roster tabs fails", async () => {
    const { service } = make(async () => { throw new Error("sheets down"); });
    await expect(service.requestLeave("d1")).resolves.toMatchObject({ characterName: "ไอดีพัง" });
  });
});
