/**
 * What the collection asked for, said out loud.
 *
 * A status breakdown is only as wide as the search behind it. When every run in
 * a scope was collected with `active_status = active`, a stopped ad was never
 * eligible to appear — so "Inactive 0" describes the question, not the
 * advertiser. Found in the pilot on real data, where a page showed
 * `Active 28 · Inactive 0 · ไม่ทราบ 0` and read like a finding.
 *
 * The value has been stored on `collection_runs` since the schema's first
 * version. All that was missing was a sentence.
 */

export type CollectionFilters = {
  runs: number;
  /** `active`, `all`, `inactive`, `mixed`, or null when never recorded. */
  active_status: string | null;
  ad_type: string | null;
  media_type: string | null;
  countries: string[];
  queries: string[];
};

/**
 * The caveat a status breakdown needs, or null when it needs none.
 *
 * Null means the search did not constrain status, so the counts stand on their
 * own. Everything else limits what a zero is allowed to mean.
 */
export function statusFilterNote(filters: CollectionFilters | null): string | null {
  const status = filters?.active_status;
  if (!status || status === "all") return null;

  if (status === "mixed") {
    return "รอบเก็บในขอบเขตนี้ใช้ตัวกรองสถานะต่างกัน — ตัวเลขแยกตามสถานะจึงเทียบกันตรง ๆ ไม่ได้";
  }
  if (status === "active") {
    return "รอบเก็บในขอบเขตนี้ขอเฉพาะโฆษณาที่ยังแสดงอยู่ — จำนวน “หยุดแล้ว” และ “ไม่ทราบ” " +
      "จึงไม่ใช่ข้อค้นพบเกี่ยวกับเพจ แต่เป็นผลจากคำค้นที่เราตั้งไว้";
  }
  if (status === "inactive") {
    return "รอบเก็บในขอบเขตนี้ขอเฉพาะโฆษณาที่หยุดแล้ว — จำนวน “กำลังแสดง” " +
      "จึงไม่ใช่ข้อค้นพบเกี่ยวกับเพจ แต่เป็นผลจากคำค้นที่เราตั้งไว้";
  }
  // An unfamiliar value is reported rather than interpreted.
  return `รอบเก็บในขอบเขตนี้กรองสถานะไว้ที่ “${status}” — ตัวเลขแยกตามสถานะจึงอ่านได้เฉพาะภายใต้ตัวกรองนี้`;
}

/** A compact description of the search behind a scope, for a context bar. */
export function collectionFilterSummary(filters: CollectionFilters | null): string {
  if (!filters || filters.runs === 0) return "—";
  const parts: string[] = [];
  if (filters.active_status) parts.push(`สถานะ ${filters.active_status}`);
  if (filters.ad_type && filters.ad_type !== "all") parts.push(`ประเภท ${filters.ad_type}`);
  if (filters.media_type && filters.media_type !== "all") parts.push(`สื่อ ${filters.media_type}`);
  if (filters.countries.length > 0) parts.push(filters.countries.join(" · "));
  return parts.length > 0 ? parts.join(" · ") : "ไม่ได้กรอง";
}
