/**
 * Request-shape guards for the read API.
 *
 * Every value here reaches a SQL function, so an id that is not a UUID must be
 * refused in TypeScript rather than sent on to raise `invalid input syntax for
 * type uuid` — that error text names the database type and would be a leak as
 * well as a 500 for what is really a bad request.
 *
 * Limits are clamped, not trusted: `?limit=100000` must not turn into an
 * unbounded table read just because the caller asked nicely.
 */

export const MAX_PAGE_SIZE = 100;
export const DEFAULT_PAGE_SIZE = 30;
export const MAX_OFFSET = 100_000;
export const MAX_SEARCH_LENGTH = 200;
export const MAX_FILTER_LENGTH = 100;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID.test(value);
}

/** Meta ad archive ids are numeric strings; anything else cannot match a row. */
export function isAdArchiveId(value: string): boolean {
  return /^\d{1,32}$/.test(value);
}

/**
 * A page size the server is willing to serve.
 *
 * Absent or unparseable → the default. Out of range → clamped to the nearest
 * end, so behaviour is the same on every call rather than depending on how the
 * caller malformed it.
 */
export function pageSize(raw: string | null): number {
  const parsed = Number(raw);
  if (raw === null || raw === "" || !Number.isFinite(parsed)) return DEFAULT_PAGE_SIZE;
  return Math.min(Math.max(Math.trunc(parsed), 1), MAX_PAGE_SIZE);
}

export function pageOffset(raw: string | null): number {
  const parsed = Number(raw);
  if (raw === null || raw === "" || !Number.isFinite(parsed)) return 0;
  return Math.min(Math.max(Math.trunc(parsed), 0), MAX_OFFSET);
}

/**
 * Trims a filter value to something a column could plausibly hold.
 *
 * An over-long value is not an error — it simply cannot match — but sending a
 * megabyte of text into an ILIKE scan would be a free way to burn database time.
 */
export function filterValue(raw: string | null, max = MAX_FILTER_LENGTH): string | null {
  if (raw === null) return null;
  const trimmed = raw.trim();
  return trimmed === "" ? null : trimmed.slice(0, max);
}

export function searchValue(raw: string | null): string | null {
  return filterValue(raw, MAX_SEARCH_LENGTH);
}

const ACTIVE_VALUES = ["active", "inactive", "unknown"] as const;

/** `?active=` accepts three words. Anything else is a bad request, not "any". */
export function activeFilter(raw: string | null): { ok: true; value: string | null } | { ok: false } {
  const value = filterValue(raw);
  if (value === null) return { ok: true, value: null };
  return (ACTIVE_VALUES as readonly string[]).includes(value)
    ? { ok: true, value }
    : { ok: false };
}
