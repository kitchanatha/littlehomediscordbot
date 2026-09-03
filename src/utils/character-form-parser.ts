import { normalizeName } from "./normalize.js";

// Matches the guild's registration-form template posted in the auto-register channel.
// Members type this by hand, so both label variants are common, e.g.:
//   ชื่อในเกม : หมาคง        (most common — no ส์)
//   ชื่อในเกมส์ : หมาคง       (also seen)
//   ชื่อเล่น : แชมป์
//   คลาส : พระ               (most common)
//   อาชีพ : พระ              (also seen)
//   เพศ : ชาย
//   อายุ : 28
const LABEL_CLASS_KEYS = ["คลาส", "อาชีพ"];

export interface ParsedCharacterForm {
  characterName: string | null;
  rawClass: string | null;
}

export function parseCharacterForm(content: string): ParsedCharacterForm {
  const fields = new Map<string, string>();
  for (const line of content.split(/\r?\n/)) {
    const match = /^\s*([^:：]+?)\s*[:：]\s*(.+?)\s*$/.exec(line);
    if (!match) continue;
    fields.set(match[1].trim(), match[2].trim());
  }

  // "ชื่อในเกม" and "ชื่อในเกมส์" both mean "in-game name" — match either, but not
  // "ชื่อเล่น" (nickname), which is a different label entirely.
  let characterName: string | null = null;
  for (const [label, value] of fields) {
    if (label.startsWith("ชื่อในเกม")) {
      characterName = value;
      break;
    }
  }

  let rawClass: string | null = null;
  for (const key of LABEL_CLASS_KEYS) {
    const value = fields.get(key);
    if (value) {
      rawClass = value;
      break;
    }
  }

  return { characterName, rawClass };
}

// Thai slang/terms and RO job-tier names members actually use, confirmed against real
// registration messages in the guild's channel. Many of these are the advanced/renewal job
// name for a class rather than the base name the sheet tracks (e.g. "Lord Knight" is
// Knight's advanced job) — this guild only tracks the base class, so those all fold into it.
const CLASS_ALIASES: Record<string, string> = {
  "อัศวิน": "Knight",
  "ไนท์": "Knight",
  "ลอร์ดไนท์": "Knight",
  "lord knight": "Knight",
  "lordknight": "Knight",
  "load knight": "Knight", // common typo
  "knight tank": "Knight",
  "ไนท์ agi": "Knight",
  "ไนท์ ดาบโล่": "Knight",

  "พาลาดิน": "Paladin",

  "ฮันเตอร์": "Hunter",
  "ฮัน": "Hunter",
  "สไน": "Hunter",
  "sniper": "Hunter",
  "sni": "Hunter",
  "archer": "Hunter",
  "acher": "Hunter", // common typo
  "ธนู": "Hunter",
  "ธนูไม้สายตึง": "Hunter",

  "แอสซาสซิน": "Assassin",
  "แอส": "Assassin",
  "asssasin": "Assassin", // common typo
  "จักพรรดิเงา (แอส)": "Assassin",
  "assassin cross": "Assassin", // Assassin's advanced job

  "วิซาร์ด": "Wizard",
  "วิ": "Wizard",
  "วิสาด": "Wizard",
  "mage": "Wizard",
  "ไสยศาสตร์": "Wizard",
  "highwizard": "Wizard", // High Wizard — Wizard's advanced job
  "high wizard": "Wizard",

  "ม้อง": "Monk",
  "แชมป์เปี้ยน": "Monk", // Champion — Monk's advanced job
  "แชมป์": "Monk", // short for แชมป์เปี้ยน
  "หลวงพี่": "Priest", // ambiguous with Monk; guild confirmed Priest

  "high priest": "Priest",
  "preist": "Priest", // common typo
  "พรีช": "Priest",
  "พรีส": "Priest",
  "แม่ชี": "Priest",
  "ไฮพรีสหญิง": "Priest",

  "แบล็คสมิธ": "Blacksmith",
  "whitesmith": "Blacksmith",
  "พ่อค้า": "Blacksmith",
  "engineer": "Blacksmith",

  "กันสลิงเกอร์": "Gunslinger",
  "ปืน": "Gunslinger",
  "มือปืน": "Gunslinger",
  "gunner": "Gunslinger",
  "night walker": "Gunslinger", // confirmed by the guild
  "มือปืนผยองเดช": "Gunslinger",
  "มือปืนมีนาย": "Gunslinger",
  "ซองสับไว(gunslinger)": "Gunslinger",
  "rebel": "Gunslinger",

  "ดรูอิด": "Druid",
  "ดรูอิทสาว": "Druid",
};

// Keyed by normalizeName(alias) so callers don't need to worry about case
// ("Sniper" vs "sniper" vs "SNIPER") — Thai text is unaffected by lowercasing.
const NORMALIZED_CLASS_ALIASES = new Map(
  Object.entries(CLASS_ALIASES).map(([alias, className]) => [normalizeName(alias), className])
);

// Resolves free-text class input (Thai slang, RO job-tier names, or plain English) to one
// of the sheet's active canonical class names. Returns null if nothing matches — callers
// should treat that as "don't auto-register", not guess.
export function resolveClassName(rawClass: string, activeClasses: string[]): string | null {
  // Strip a trailing parenthetical aside, e.g. "Lord Knight (โล่)" -> "Lord Knight",
  // "ซองสับไว(Gunslinger)" is matched as its own literal alias below instead.
  const trimmed = rawClass.trim().replace(/\s*\([^)]*\)\s*$/, "").trim() || rawClass.trim();
  if (!trimmed) return null;

  const findCanonical = (englishName: string): string | null =>
    activeClasses.find((c) => normalizeName(c) === normalizeName(englishName)) ?? null;

  // "พระ*" — any term starting with พระ (พระ, พระว้าย, ...) means Priest.
  if (trimmed.startsWith("พระ")) {
    return findCanonical("Priest");
  }

  const aliasMatch =
    NORMALIZED_CLASS_ALIASES.get(normalizeName(trimmed)) ??
    NORMALIZED_CLASS_ALIASES.get(normalizeName(rawClass.trim()));
  if (aliasMatch) {
    const canonical = findCanonical(aliasMatch);
    if (canonical) return canonical;
  }

  // English fallback: someone just typed the class name directly (allow inconsistent
  // spacing, e.g. "Black Smith" for Blacksmith).
  const noSpace = trimmed.replace(/\s+/g, "");
  return (
    findCanonical(trimmed) ??
    activeClasses.find((c) => normalizeName(c.replace(/\s+/g, "")) === normalizeName(noSpace)) ??
    null
  );
}
