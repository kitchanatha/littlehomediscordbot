export function normalizeName(value: string): string {
  return value.normalize("NFKC").trim().toLocaleLowerCase("en-US");
}

// Strips everything but letters/digits/Thai script — for matching the same name written with
// different decoration (emoji prefixes, symbols, spacing) as the same person. Thai tone/vowel
// marks (ั ิ ี ึ ื ุ ู ่ ้ ๊ ๋ ์ ํ ็ — Unicode category Mn, nonspacing marks) fall inside the
// ก-๙ range so the character-class filter alone doesn't drop them; stripped explicitly first
// so e.g. "ิBellamie" and "Bellamie" reduce to the same core name instead of looking unrelated.
export function coreName(value: string): string {
  return normalizeName(value)
    .replace(/\p{Mn}/gu, "")
    .replace(/[^a-z0-9ก-๙]/g, "");
}

// Splits a hand-typed "primary/alt-name" style value (seen on sheet rows where someone kept an
// old nickname alongside a current one, e.g. "Amojoeee/NinjaRed-N-") into individual candidates.
function nameCandidates(value: string): string[] {
  return value.split("/").map((s) => s.trim()).filter(Boolean);
}

// Decoration- and alt-name-insensitive equality: true if `a` and `b` (or any "/"-separated
// segment of either) share a core name. Use this instead of a raw normalizeName/coreName
// comparison whenever matching a name against sheet data someone may have hand-typed with
// different decoration, or as a combined "old/new" label — a plain coreName(a) === coreName(b)
// check would miss both of those.
export function namesMatch(a: string, b: string): boolean {
  const aCores = new Set(nameCandidates(a).map(coreName));
  const bCores = nameCandidates(b).map(coreName);
  return bCores.some((c) => aCores.has(c));
}
