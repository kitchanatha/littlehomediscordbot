import { resolveClassName } from "./character-form-parser.js";

const HEADER_NAME = "เปลี่ยนชื่อ";
const HEADER_CLASS = "เปลี่ยนอาชีพ";

// Matches an "old -> new" pair written with any of the separators members actually use:
// >>, →, -->, TO, 👉, or the phrase "เปลี่ยนจาก X มาเป็น Y".
const PHRASE_PATTERN = /เปลี่ยนจาก\s*(.+?)\s*มาเป็น\s*(.+)/;
const ARROW_PATTERN = /^(.+?)\s*(?:>{2,}|→|-{2,}>|-+>|👉|\bTO\b)\s*(.+?)$/i;

interface ChangeLine {
  before: string;
  after: string;
  hasNameHeader: boolean;
  hasClassHeader: boolean;
}

export interface ParsedNameClassChange {
  newName: string | null;
  newClass: string | null;
  // Set when the message looked like a class-change attempt but the value didn't resolve
  // to a known class.
  unresolvedClass: string | null;
  // Set when the message contains more than one name-change (or class-change) line — e.g.
  // an officer batch-reporting several other members' changes at once. Too ambiguous to
  // safely auto-apply to "the poster's own profile", so newName/newClass stay null.
  ambiguousMultipleTargets: boolean;
}

function findChangeLines(content: string): ChangeLine[] {
  const lines: ChangeLine[] = [];
  for (const rawLine of content.split(/\r?\n/)) {
    const hasNameHeader = rawLine.includes(HEADER_NAME);
    const hasClassHeader = rawLine.includes(HEADER_CLASS);

    const phraseMatch = PHRASE_PATTERN.exec(rawLine);
    if (phraseMatch) {
      lines.push({ before: phraseMatch[1].trim(), after: phraseMatch[2].trim(), hasNameHeader, hasClassHeader });
      continue;
    }

    const arrowMatch = ARROW_PATTERN.exec(rawLine.trim());
    if (arrowMatch) {
      lines.push({ before: arrowMatch[1].trim(), after: arrowMatch[2].trim(), hasNameHeader, hasClassHeader });
    }
  }
  return lines;
}

// Self-service only: the target is always the poster's own registered profile, so we don't
// need a character name in the message — only which field (name and/or class) changed, and
// to what. A message can change both at once (separate name-line and class-line). Returns
// nulls if the message doesn't look like a change request at all.
export function parseNameClassChange(content: string, activeClasses: string[]): ParsedNameClassChange {
  const messageHasNameHeader = content.includes(HEADER_NAME);
  const messageHasClassHeader = content.includes(HEADER_CLASS);

  const nameCandidates: string[] = [];
  const classCandidates: string[] = [];
  const unresolvedClassCandidates: string[] = [];

  for (const line of findChangeLines(content)) {
    // Prefer this line's own header; fall back to a header appearing anywhere in the
    // message (common when the header is on its own line above the arrow line).
    const isNameLine = line.hasNameHeader || (!line.hasClassHeader && messageHasNameHeader && !messageHasClassHeader);
    const isClassLine = line.hasClassHeader || (!line.hasNameHeader && messageHasClassHeader && !messageHasNameHeader);

    if (isNameLine) {
      nameCandidates.push(line.after);
      continue;
    }

    if (isClassLine) {
      const resolved = resolveClassName(line.after, activeClasses);
      if (resolved) classCandidates.push(resolved);
      else unresolvedClassCandidates.push(line.after);
      continue;
    }

    // No header anywhere — classify by content: does "after" look like a class?
    const resolvedAfter = resolveClassName(line.after, activeClasses);
    if (resolvedAfter) {
      classCandidates.push(resolvedAfter);
    } else if (resolveClassName(line.before, activeClasses)) {
      // "before" IS a recognized class, so this is a class-change attempt to something
      // unresolved — don't misfile it as a name change.
      unresolvedClassCandidates.push(line.after);
    } else {
      nameCandidates.push(line.after);
    }
  }

  if (nameCandidates.length === 0 && classCandidates.length === 0 && unresolvedClassCandidates.length === 0) {
    return { newName: null, newClass: null, unresolvedClass: null, ambiguousMultipleTargets: false };
  }

  const ambiguous = nameCandidates.length > 1 || classCandidates.length > 1;
  if (ambiguous) {
    return { newName: null, newClass: null, unresolvedClass: null, ambiguousMultipleTargets: true };
  }

  return {
    newName: nameCandidates[0] ?? null,
    newClass: classCandidates[0] ?? null,
    unresolvedClass: classCandidates.length === 0 ? unresolvedClassCandidates[0] ?? null : null,
    ambiguousMultipleTargets: false,
  };
}
