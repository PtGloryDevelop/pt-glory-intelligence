/**
 * The Explorer filter contract.
 *
 * One place defines which filters exist, what they are called in a URL, and how
 * they read back as chips. The API route validates the same names, so a link
 * like `?evergreen=true&format=VIDEO` works whether it was built by the toolbar
 * or by some future dashboard drilling down into a number it just displayed.
 *
 * No filter here derives anything. Each one names a stored field or a rule that
 * is defined in SQL (evergreen, reuse), and the server decides what matches.
 */

export type FilterKey =
  | "search" | "active" | "format" | "cta" | "platform" | "category" | "page"
  | "startedFrom" | "startedTo"
  | "firstSeenFrom" | "firstSeenTo"
  | "lastSeenFrom" | "lastSeenTo"
  | "ageMin" | "ageMax"
  | "evergreen" | "reuseMin"
  | "hasVideo" | "hasImage" | "hasTitle" | "hasDestination";

export type Filters = Partial<Record<FilterKey, string>>;

/** Everything the toolbar shows without opening Advanced. */
export const PRIMARY_KEYS: FilterKey[] = ["search", "active", "format", "cta", "platform", "page"];

export const ADVANCED_KEYS: FilterKey[] = [
  "startedFrom", "startedTo", "firstSeenFrom", "firstSeenTo",
  "lastSeenFrom", "lastSeenTo", "ageMin", "ageMax",
  "evergreen", "reuseMin", "category",
  "hasVideo", "hasImage", "hasTitle", "hasDestination",
];

export const ALL_KEYS: FilterKey[] = [...PRIMARY_KEYS, ...ADVANCED_KEYS];

export const SORTS: { key: string; label: string }[] = [
  { key: "started_desc", label: "เริ่มแสดงล่าสุด" },
  { key: "started_asc", label: "เริ่มแสดงเก่าสุด" },
  { key: "discovered_desc", label: "พบครั้งแรกล่าสุด" },
  { key: "observed_desc", label: "สังเกตล่าสุด" },
  { key: "longest_running", label: "รันนานที่สุด" },
  { key: "most_reused", label: "ใช้ซ้ำมากที่สุด" },
  { key: "page_name", label: "ชื่อเพจ" },
];

export const DEFAULT_SORT = "started_desc";

const LABEL: Record<FilterKey, string> = {
  search: "ค้นหา", active: "สถานะ", format: "รูปแบบ", cta: "CTA",
  platform: "แพลตฟอร์ม", category: "หมวดเพจ", page: "เพจ",
  startedFrom: "เริ่มแสดงตั้งแต่", startedTo: "เริ่มแสดงถึง",
  firstSeenFrom: "พบครั้งแรกตั้งแต่", firstSeenTo: "พบครั้งแรกถึง",
  lastSeenFrom: "พบล่าสุดตั้งแต่", lastSeenTo: "พบล่าสุดถึง",
  ageMin: "อายุอย่างน้อย (วัน)", ageMax: "อายุไม่เกิน (วัน)",
  evergreen: "Evergreen", reuseMin: "ใช้ซ้ำอย่างน้อย",
  hasVideo: "มีวิดีโอ", hasImage: "มีภาพ",
  hasTitle: "มีหัวเรื่อง", hasDestination: "มีลิงก์ปลายทาง",
};

const BOOLEAN_KEYS: FilterKey[] = ["evergreen", "hasVideo", "hasImage", "hasTitle", "hasDestination"];

/**
 * Chip text for one applied filter. `display` lets the caller substitute a
 * facet's label — the Page filter matches on page_id but must read as a name.
 */
export function chipLabel(key: FilterKey, value: string, display?: string): string {
  if (BOOLEAN_KEYS.includes(key)) {
    return value === "false" ? `ไม่${LABEL[key]}` : LABEL[key];
  }
  return `${LABEL[key]}: ${display ?? value}`;
}

export function filterLabel(key: FilterKey): string {
  return LABEL[key];
}

/** Filters that are actually set, in the order the toolbar presents them. */
export function appliedFilters(filters: Filters): { key: FilterKey; value: string }[] {
  return ALL_KEYS
    .filter((key) => (filters[key] ?? "") !== "")
    .map((key) => ({ key, value: filters[key] as string }));
}

export function fromQuery(query: URLSearchParams): { filters: Filters; sort: string; offset: number } {
  const filters: Filters = {};
  for (const key of ALL_KEYS) {
    const value = query.get(key);
    if (value !== null && value !== "") filters[key] = value;
  }
  const sort = query.get("sort");
  const offset = Number(query.get("offset"));
  return {
    filters,
    sort: SORTS.some((option) => option.key === sort) ? (sort as string) : DEFAULT_SORT,
    offset: Number.isFinite(offset) && offset > 0 ? Math.trunc(offset) : 0,
  };
}

/**
 * The canonical query string for a research state. Defaults are omitted so a
 * shared URL carries only what the analyst actually chose.
 */
export function toQuery(filters: Filters, sort: string, offset: number): URLSearchParams {
  const query = new URLSearchParams();
  for (const key of ALL_KEYS) {
    const value = filters[key];
    if (value !== undefined && value !== "") query.set(key, value);
  }
  if (sort !== DEFAULT_SORT) query.set("sort", sort);
  if (offset > 0) query.set("offset", String(offset));
  return query;
}

/** Fields whose coverage decides whether a presence filter can be trusted. */
export const PRESENCE_SOURCE: Partial<Record<FilterKey, string>> = {
  hasTitle: "title",
  hasDestination: "link_url",
  hasVideo: "videos",
  hasImage: "images",
};
