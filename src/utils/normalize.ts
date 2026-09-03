export function normalizeName(value: string): string {
  return value.normalize("NFKC").trim().toLocaleLowerCase("en-US");
}

// Strips everything but letters/digits/Thai script — for matching the same name written with
// different decoration (emoji prefixes, symbols, spacing) as the same person.
export function coreName(value: string): string {
  return normalizeName(value).replace(/[^a-z0-9ก-๙]/g, "");
}
