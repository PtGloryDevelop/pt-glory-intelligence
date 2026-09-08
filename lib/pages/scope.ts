/**
 * The data scope a Page result is about.
 *
 * Every number on a Page surface is an aggregate, and an aggregate with no
 * stated scope is a claim about "the market" — which this product has no
 * standing to make. So the scope is part of the address: it is in the URL, it is
 * on the screen, and there is no default that quietly means "everything".
 *
 * Inside a dataset there is exactly one collection run, so the scope resolves to
 * that dataset's snapshot and Snapshot Truth is unchanged. The wider scopes read
 * the most recent observation of each ad among the runs they contain — the same
 * rule, applied to more runs.
 */

export type PageScope =
  | { kind: "dataset"; id: string }
  | { kind: "category"; id: string }
  | { kind: "all" };

export const SCOPE_PARAM = "scope";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** `dataset:<uuid>` · `category:<uuid>` · `all`. Anything else is not a scope. */
export function parseScope(raw: string | null | undefined): PageScope | null {
  if (!raw) return null;
  if (raw === "all") return { kind: "all" };
  const [kind, id] = raw.split(":");
  if ((kind === "dataset" || kind === "category") && id && UUID.test(id)) {
    return { kind, id };
  }
  return null;
}

export function scopeToParam(scope: PageScope): string {
  return scope.kind === "all" ? "all" : `${scope.kind}:${scope.id}`;
}

/** The shape the SQL functions take: a kind and an optional id. */
export function scopeArgs(scope: PageScope): { p_scope: string; p_scope_id: string | null } {
  return { p_scope: scope.kind, p_scope_id: scope.kind === "all" ? null : scope.id };
}

/**
 * What the reader is told they are looking at.
 *
 * `name` is supplied by the caller because only it has read the dataset or
 * category row; this function decides the wording, not the lookup.
 */
export function scopeLabel(scope: PageScope, name?: string | null): string {
  if (scope.kind === "all") return "ทุกข้อมูลที่เก็บมา";
  if (scope.kind === "dataset") return `Dataset: ${name ?? scope.id}`;
  return `หมวดหมู่: ${name ?? scope.id}`;
}

/**
 * How the values in this scope were chosen, in the reader's words.
 *
 * A dataset is pinned to its own run. A wider scope is not, and saying so is
 * the difference between a number the reader can trust and one they cannot
 * place.
 */
export function scopeBasis(scope: PageScope): string {
  return scope.kind === "dataset"
    ? "ค่าทั้งหมดมาจากรอบเก็บของ Dataset นี้เท่านั้น"
    : "ค่าทั้งหมดมาจากการสังเกตล่าสุดของแต่ละโฆษณาภายในขอบเขตนี้ ไม่ใช่ snapshot ของ Dataset ใด";
}

/** Windows for "recently found". One definition, shared by every surface. */
export const RECENT_DAYS = [7, 14, 30] as const;
export const DEFAULT_RECENT_DAYS = 30;

export function recentDays(raw: string | null | undefined): number {
  const parsed = Number(raw);
  return (RECENT_DAYS as readonly number[]).includes(parsed) ? parsed : DEFAULT_RECENT_DAYS;
}

/**
 * Sorts the Page list is willing to order by — keys, never column names.
 *
 * Nothing here sorts by performance, because the source carries none.
 */
export const PAGE_SORTS: { key: string; label: string }[] = [
  { key: "observed_ads", label: "Ads ที่พบมากสุด" },
  { key: "recently_found", label: "พบใหม่ล่าสุดมากสุด" },
  { key: "evergreen", label: "Evergreen มากสุด" },
  { key: "reuse", label: "ใช้ซ้ำสูงสุด" },
  { key: "first_observed", label: "เริ่มพบล่าสุด" },
  { key: "last_observed", label: "สังเกตล่าสุด" },
  { key: "page_name", label: "ชื่อเพจ" },
];

export const DEFAULT_PAGE_SORT = "observed_ads";

export function pageSortKey(raw: string | null | undefined): string | null {
  if (!raw) return DEFAULT_PAGE_SORT;
  return PAGE_SORTS.some((option) => option.key === raw) ? raw : null;
}

/**
 * The signals a Page detail can drill into.
 *
 * The names say what was measured. None of them says "best", "top" or
 * "winning": the database knows when an ad was first seen, how long it has been
 * running and how many creatives it was collated with, and knows nothing at all
 * about whether any of it worked.
 */
export const PAGE_SIGNALS = [
  "recent", "started_recently", "evergreen", "reused", "active", "inactive", "unknown",
] as const;

export type PageSignal = (typeof PAGE_SIGNALS)[number];

export function pageSignal(raw: string | null | undefined): PageSignal | null {
  return (PAGE_SIGNALS as readonly string[]).includes(raw ?? "") ? (raw as PageSignal) : null;
}

export const SIGNAL_LABEL: Record<PageSignal, string> = {
  recent: "พบใหม่",
  started_recently: "เริ่มแสดงใหม่",
  evergreen: "Evergreen",
  reused: "ใช้ซ้ำ",
  active: "Active",
  inactive: "Inactive",
  unknown: "ไม่ทราบสถานะ",
};
