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
