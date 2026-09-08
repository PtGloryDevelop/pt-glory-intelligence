/**
 * The Category workspace's contract.
 *
 * A PT Glory Category is the product's own research grouping — the thing a
 * dataset is imported into. Meta's `page_categories` ("Medical Center") is
 * unrelated free metadata that happens to share the English word, and both
 * appear on this screen. Everything here that means ours says `category`;
 * everything that means Meta's says `pageCategory`, and the UI labels it
 * "หมวดเพจ (จาก Meta)".
 */

/** Ways to order the page ranking. Keys, never column names. */
export const CATEGORY_PAGE_SORTS: { key: string; label: string }[] = [
  { key: "observed_ads", label: "Ads ที่เราพบมากสุด" },
  { key: "recently_found", label: "พบใหม่มากสุด" },
  { key: "started_recently", label: "เริ่มแสดงใหม่มากสุด" },
  { key: "evergreen", label: "Evergreen มากสุด" },
  { key: "reuse", label: "ใช้ซ้ำสูงสุด" },
  { key: "last_observed", label: "สังเกตล่าสุด" },
  { key: "page_name", label: "ชื่อเพจ" },
];

export const DEFAULT_CATEGORY_SORT = "observed_ads";

export function categorySortKey(raw: string | null | undefined): string | null {
  if (!raw) return DEFAULT_CATEGORY_SORT;
  return CATEGORY_PAGE_SORTS.some((option) => option.key === raw) ? raw : null;
}

/**
 * How a page's slice of the category is allowed to be described.
 *
 * The denominator is the ads PT Glory observed in this category — a fact about
 * our collection, not about a market. So the phrase is fixed here rather than
 * left to whoever writes the next panel, and it always carries the pair.
 */
export function observedShare(pageAds: number, categoryAds: number): {
  percent: number;
  pair: string;
  label: string;
} {
  const percent = categoryAds <= 0 ? 0 : (pageAds / categoryAds) * 100;
  return {
    percent,
    pair: `${pageAds.toLocaleString("th-TH")} / ${categoryAds.toLocaleString("th-TH")}`,
    label: "สัดส่วนจาก Ads ที่เราพบในหมวดนี้",
  };
}

/**
 * The caveat that must sit near the category's identity.
 *
 * A category is assembled from several collection runs taken at different
 * moments, often with different queries. It is emphatically not one
 * synchronized picture of a market, and this is the sentence that says so.
 */
export const CATEGORY_BASIS =
  "มุมมองนี้ประกอบจากหลายรอบเก็บของหลาย Dataset ไม่ใช่ snapshot เดียวของตลาด " +
  "ตัวเลขทั้งหมดคือสิ่งที่ PT Glory เก็บมาได้ ไม่ใช่ทั้งตลาด";

/** Values shown per contributing dataset, used to judge comparability. */
export type DatasetContext = { scope_query: string | null; scope_country: string | null };

/**
 * Whether the contributing datasets asked the same question of the same market.
 *
 * Same rule and same wording as the page timeline's: when they differ, a
 * difference between them may be the collection rather than the advertisers,
 * and the reader is told rather than shown a corrected number.
 */
export function datasetComparability(datasets: DatasetContext[]): {
  comparable: boolean;
  note: string | null;
} {
  const queries = [...new Set(datasets.map((row) => row.scope_query ?? "—"))];
  const countries = [...new Set(datasets.map((row) => row.scope_country ?? "—"))];
  if (queries.length <= 1 && countries.length <= 1) return { comparable: true, note: null };

  const parts = [
    queries.length > 1 ? `คำค้น ${queries.join(" / ")}` : "",
    countries.length > 1 ? `ประเทศ ${countries.join(" / ")}` : "",
  ].filter(Boolean);

  return {
    comparable: false,
    note: `Dataset ในหมวดนี้เก็บด้วยเงื่อนไขต่างกัน (${parts.join(" · ")}) — ` +
      "ตัวเลขที่ต่างกันจึงอาจมาจากขอบเขตการเก็บ ไม่ใช่ความต่างของเพจหรือของตลาด",
  };
}
