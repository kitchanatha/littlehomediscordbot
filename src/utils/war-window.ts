// War is held on Tuesday, Thursday and Sunday; members can check in from 05:00 until the end of
// that day (23:59), Asia/Bangkok time. The bot's server runs in UTC, so the weekday and hour
// must be read in Bangkok time explicitly rather than from the local clock.
const WAR_WEEKDAYS = new Set(["Tue", "Thu", "Sun"]);
const OPEN_HOUR = 5;

export function isWarCheckInOpen(at: Date = new Date()): boolean {
  const parts = new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    hour: "numeric",
    hourCycle: "h23",
    timeZone: "Asia/Bangkok",
  }).formatToParts(at);
  const weekday = parts.find((p) => p.type === "weekday")?.value ?? "";
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
  return WAR_WEEKDAYS.has(weekday) && hour >= OPEN_HOUR;
}

export const WAR_CHECKIN_CLOSED_MESSAGE =
  "❌ War check-in is only open on Tuesday, Thursday and Sunday, 05:00-23:59.\n❌ เช็คอินวอร์ได้เฉพาะวันอังคาร พฤหัสบดี และอาทิตย์ เวลา 05.00-23.59 น. เท่านั้น";

export interface BangkokDay {
  year: number;
  month: number; // 1-12
  day: number;
}

// The calendar date at `at` in Bangkok (not the server's UTC date — between 00:00 and 06:59
// Bangkok time the two differ by one day).
export function bangkokDay(at: Date = new Date()): BangkokDay {
  const parts = new Intl.DateTimeFormat("en-US", { year: "numeric", month: "numeric", day: "numeric", timeZone: "Asia/Bangkok" }).formatToParts(at);
  const num = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? "0");
  return { year: num("year"), month: num("month"), day: num("day") };
}

export function previousBangkokDay(at: Date = new Date()): BangkokDay {
  const today = bangkokDay(at);
  const prev = new Date(Date.UTC(today.year, today.month - 1, today.day - 1));
  return { year: prev.getUTCFullYear(), month: prev.getUTCMonth() + 1, day: prev.getUTCDate() };
}

export function isWarDay(day: BangkokDay): boolean {
  return WAR_WEEKDAYS_NUM.has(new Date(Date.UTC(day.year, day.month - 1, day.day)).getUTCDay());
}

// An instant that falls on `day` in Bangkok (noon), for resolving that day's attendance column.
export function bangkokNoon(day: BangkokDay): Date {
  return new Date(Date.UTC(day.year, day.month - 1, day.day, 5, 0, 0));
}

// The last instant (23:59:59.999 Bangkok) of `day`.
export function bangkokEndOfDay(day: BangkokDay): Date {
  return new Date(Date.UTC(day.year, day.month - 1, day.day, 16, 59, 59, 999));
}

const WAR_WEEKDAYS_NUM = new Set([0, 2, 4]); // Sun, Tue, Thu

// The war a summary should describe: today if it is a war day and check-in has opened (05:00),
// otherwise the most recent war day before that. Outside war days (or before check-in opens on one)
// "today" has no attendance column, so summarising it would report everyone as absent.
export function latestWarDay(at: Date = new Date()): BangkokDay {
  const today = bangkokDay(at);
  const hour = Number(
    new Intl.DateTimeFormat("en-US", { hour: "numeric", hourCycle: "h23", timeZone: "Asia/Bangkok" })
      .formatToParts(at)
      .find((p) => p.type === "hour")?.value ?? "0"
  );
  if (isWarDay(today) && hour >= OPEN_HOUR) return today;
  for (let back = 1; back <= 7; back++) {
    const d = new Date(Date.UTC(today.year, today.month - 1, today.day - back));
    const day = { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
    if (isWarDay(day)) return day;
  }
  return today; // unreachable: every week has war days
}

const THAI_WEEKDAYS = ["อาทิตย์", "จันทร์", "อังคาร", "พุธ", "พฤหัสบดี", "ศุกร์", "เสาร์"];

// e.g. "วันอังคารที่ 6/10/69" (Buddhist-era two-digit year, matching the sheet's War column headers).
export function formatWarDay(day: BangkokDay): string {
  const weekday = THAI_WEEKDAYS[new Date(Date.UTC(day.year, day.month - 1, day.day)).getUTCDay()];
  return `วัน${weekday}ที่ ${day.day}/${day.month}/${(day.year + 543) % 100}`;
}
