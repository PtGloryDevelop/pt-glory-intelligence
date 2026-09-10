/**
 * What a Page-vs-Page comparison is allowed to be.
 *
 * Compare adds no new intelligence. It puts two sets of already-frozen numbers
 * side by side and states the arithmetic difference — which is why almost all
 * of this file is about what may NOT be said. A delta is a subtraction; it is
 * not evidence that one advertiser is doing better than another, and this
 * product has no data that could support that claim.
 */

export type Side = "a" | "b";

/** The dimensions a comparison can drill into. Keys, never expressions. */
export const COMPARE_METRICS = [
  "observed", "recent", "started_recently", "evergreen", "reused",
  "active", "inactive", "unknown",
] as const;

export type CompareMetric = (typeof COMPARE_METRICS)[number];

export function compareMetric(raw: string | null | undefined): CompareMetric | null {
  return (COMPARE_METRICS as readonly string[]).includes(raw ?? "")
    ? (raw as CompareMetric)
    : null;
}

/**
 * The row labels of the summary matrix.
 *
 * `signal` is the frozen P2.1 signal name this row drills into, so the number
 * in the matrix and the ads behind it are the same definition — there is no
 * compare-specific "evergreen".
 */
export const COMPARE_ROWS: {
  metric: CompareMetric;
  label: string;
  helper: string;
  signal: string | null;
}[] = [
  {
    metric: "observed", label: "Ads ที่เราพบ",
    helper: "โฆษณาที่ไม่ซ้ำกันในขอบเขตนี้", signal: null,
  },
  {
    metric: "recent", label: "PT Glory พบใหม่",
    helper: "นับจากวันที่เราเห็นครั้งแรก", signal: "recent",
  },
  {
    metric: "started_recently", label: "เริ่มแสดงใหม่",
    helper: "นับจากวันที่ Meta ระบุว่าเริ่มแสดง — คนละค่ากับพบใหม่", signal: "started_recently",
  },
  {
    metric: "evergreen", label: "Evergreen",
    helper: "ยังแสดงอยู่ และอายุถึงเกณฑ์ที่ตั้งไว้", signal: "evergreen",
  },
  {
    metric: "reused", label: "ใช้ซ้ำ",
    helper: "โฆษณาที่ collation > 1 — ไม่ได้แปลว่าไฟล์เหมือนกัน และไม่ได้บอกผลลัพธ์", signal: "reused",
  },
  { metric: "active", label: "Active", helper: "สถานะที่อ่านได้ล่าสุด", signal: "active" },
  { metric: "inactive", label: "Inactive", helper: "สถานะที่อ่านได้ล่าสุด", signal: "inactive" },
  {
    metric: "unknown", label: "ไม่ทราบสถานะ",
    helper: "รอบเก็บอ่านสถานะไม่ได้ — ไม่ใช่หยุดแสดง", signal: "unknown",
  },
];

/**
 * The difference between two sides, in words that stay arithmetic.
 *
 * "A มากกว่า B 11 รายการ" is a subtraction anyone can check. "A ชนะ" is a claim
 * about advertising outcomes, which nothing in this database can support — so
 * the sentence is built here once rather than written by hand per surface.
 */
export function delta(a: number, b: number): {
  value: number;
  leader: Side | null;
  label: string;
} {
  const value = a - b;
  if (value === 0) return { value: 0, leader: null, label: "เท่ากัน" };
  const leader: Side = value > 0 ? "a" : "b";
  const size = Math.abs(value).toLocaleString("th-TH");
  return {
    value,
    leader,
    // Which side, how many, and of what — never who is doing better.
    label: `${leader === "a" ? "A" : "B"} มากกว่า ${size} รายการ`,
  };
}

/**
 * The two clocks a comparison chart may use, one at a time.
 *
 * Both sides always take the same one. A chart that put A's start dates beside
 * B's first sightings would be drawn correctly and mean nothing.
 */
/**
 * What a comparison answers, and the answer it refuses to give.
 *
 * Every other surface in this product opens with a sentence like this. Compare
 * was the one screen without one: a chooser, then eight hundred pixels of
 * nothing, and no way for a first-time reader to learn what putting two pages
 * side by side is going to tell them — or, more importantly, what it will not.
 */
export const COMPARE_BASIS =
  "เปรียบเทียบเพจสองเพจในขอบเขตข้อมูลเดียวกัน แสดงเป็นผลต่างของสิ่งที่เราเก็บมาได้ · " +
  "ระบบไม่ตัดสินว่าใครดีกว่า เพราะข้อมูลที่มีบอกไม่ได้ — " +
  "เพจที่เราเก็บเจอโฆษณามากกว่า ไม่ได้แปลว่าขายดีกว่า ใช้งบมากกว่า หรือได้ผลดีกว่า";

/** Why the chooser needs a scope before it will show anything. */
export const COMPARE_SCOPE_HINT =
  "ต้องเลือกขอบเขตข้อมูลก่อน เพราะตัวเลขของเพจหนึ่งในหมวดหนึ่ง " +
  "กับตัวเลขของเพจเดียวกันในอีกขอบเขต เป็นคนละคำถามและได้คนละคำตอบ";

export const COMPARE_CLOCKS = ["started", "first_seen"] as const;
export type CompareClock = (typeof COMPARE_CLOCKS)[number];

export function compareClock(raw: string | null | undefined): CompareClock {
  return (COMPARE_CLOCKS as readonly string[]).includes(raw ?? "")
    ? (raw as CompareClock)
    : "started";
}

/** Why two pages cannot be compared, when they cannot. */
export type CompareRefusal =
  | { kind: "incomplete" }
  | { kind: "same-page" }
  | { kind: "missing"; side: Side };

/**
 * The comparison contract: one scope, two different pages, both represented.
 *
 * "Not in this scope" is deliberately not turned into zero. A page with no ads
 * here and a page that this scope has never heard of are different answers, and
 * a zero would quietly claim the first when the truth is the second.
 */
export function validateCompare(input: {
  pageA: string | null;
  pageB: string | null;
  aInScope: boolean;
  bInScope: boolean;
}): CompareRefusal | null {
  if (!input.pageA || !input.pageB) return { kind: "incomplete" };
  if (input.pageA === input.pageB) return { kind: "same-page" };
  if (!input.aInScope) return { kind: "missing", side: "a" };
  if (!input.bInScope) return { kind: "missing", side: "b" };
  return null;
}

export const REFUSAL_MESSAGE: Record<CompareRefusal["kind"], string> = {
  incomplete: "เลือกขอบเขตข้อมูล และเพจสองเพจ ก่อนเปรียบเทียบ",
  "same-page": "เลือกคนละเพจ — การเปรียบเทียบเพจกับตัวเองไม่ได้บอกอะไร",
  missing: "เพจนี้ไม่ได้อยู่ในขอบเขตที่เลือก — ไม่ใช่ว่าพบ 0 รายการ",
};

/** Meta page ids are numeric strings; anything else cannot name a page. */
export function isComparablePageId(value: string | null | undefined): value is string {
  return typeof value === "string" && /^\d{1,32}$/.test(value);
}
