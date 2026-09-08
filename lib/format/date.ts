/**
 * Dates the way this product shows them.
 *
 * One formatter, because the audit found raw ISO strings leaking into the UI
 * beside Thai-formatted ones — `2026-08-26T07:00:00.000Z` in a table next to
 * `26 ส.ค. 2569` in a card. A reader cannot tell those are the same kind of fact.
 *
 * Thai locale means Buddhist-era years, which is what the rest of the interface
 * already uses.
 */

const DATE = new Intl.DateTimeFormat("th-TH", { day: "numeric", month: "short", year: "numeric" });
const DATE_TIME = new Intl.DateTimeFormat("th-TH", {
  day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
});

function parse(value: string | Date | null | undefined): Date | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Day precision. `—` for anything absent or unparseable — never the raw string. */
export function thaiDate(value: string | Date | null | undefined): string {
  const date = parse(value);
  return date ? DATE.format(date) : "—";
}

/** Day and time, for observation timestamps where the hour carries meaning. */
export function thaiDateTime(value: string | Date | null | undefined): string {
  const date = parse(value);
  return date ? DATE_TIME.format(date) : "—";
}
