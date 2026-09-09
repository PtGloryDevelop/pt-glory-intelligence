/**
 * What a Brand is in PT Glory, and — as with the Watchlist — what it is not.
 *
 * A Brand is an editorial grouping of Pages made by a person. It is not a fact
 * the collector reported, not a similarity score, and not an identity rule:
 * `Page != Brand` stays frozen, and nothing here turns a Page into a Brand
 * because two names look alike.
 *
 * The vocabulary lives in one file so no surface can quietly promise inference.
 */

export const BRAND_STATUSES = ["active", "archived"] as const;
export type BrandStatus = (typeof BRAND_STATUSES)[number];

export function brandStatus(raw: string | null | undefined): BrandStatus | null {
  return (BRAND_STATUSES as readonly string[]).includes(raw ?? "")
    ? (raw as BrandStatus)
    : null;
}

export const STATUS_LABEL: Record<BrandStatus, string> = {
  active: "ใช้งาน",
  archived: "เก็บเข้าคลัง",
};

export const MAX_BRAND_NAME = 120;
export const MAX_BRAND_NOTES = 2000;
export const MAX_MAPPING_NOTE = 500;

/**
 * A Brand name the database will accept.
 *
 * Deliberately no normalization here. The canonical normalized form lives in
 * SQL (`brand_normalized_name`) because it decides uniqueness; a second copy in
 * TypeScript would drift and then disagree with the index that actually
 * enforces it.
 */
export function brandName(raw: unknown): { ok: true; value: string } | { ok: false; reason: string } {
  if (typeof raw !== "string") return { ok: false, reason: "ต้องระบุชื่อแบรนด์" };
  const value = raw.trim();
  if (value.length === 0) return { ok: false, reason: "ต้องระบุชื่อแบรนด์" };
  if (value.length > MAX_BRAND_NAME) {
    return { ok: false, reason: `ชื่อแบรนด์ยาวเกิน ${MAX_BRAND_NAME} ตัวอักษร` };
  }
  return { ok: true, value };
}

export function optionalText(raw: unknown, max: number): { ok: true; value: string | null } | { ok: false; reason: string } {
  if (raw === null || raw === undefined || raw === "") return { ok: true, value: null };
  if (typeof raw !== "string") return { ok: false, reason: "ต้องเป็นข้อความ" };
  const value = raw.trim();
  if (value.length === 0) return { ok: true, value: null };
  if (value.length > max) return { ok: false, reason: `ข้อความยาวเกิน ${max} ตัวอักษร` };
  return { ok: true, value };
}

/* ------------------------------------------------------------ review queue */

export const UNMAPPED_SORTS = [
  "observed_ads", "recently_found", "last_observed", "page_name",
] as const;
export type UnmappedSort = (typeof UNMAPPED_SORTS)[number];

export function unmappedSort(raw: string | null | undefined): UnmappedSort {
  return (UNMAPPED_SORTS as readonly string[]).includes(raw ?? "")
    ? (raw as UnmappedSort)
    : "observed_ads";
}

export const UNMAPPED_SORT_LABEL: Record<UnmappedSort, string> = {
  observed_ads: "Ads ที่พบมากสุด",
  recently_found: "พบใหม่ล่าสุด",
  last_observed: "สังเกตล่าสุด",
  page_name: "ชื่อเพจ",
};

/* ---------------------------------------------------------------- wording */

/**
 * The sentence that keeps the grouping honest, shown wherever a Brand is.
 *
 * Two claims it refuses in advance: that Meta said any of this, and that the
 * system worked it out. A researcher did, and their name is on the row.
 */
export const BRAND_BASIS =
  "แบรนด์คือการจัดกลุ่มเพจโดยทีม PT Glory เอง ไม่ใช่ข้อมูลจาก Meta " +
  "และไม่ได้เดาจากชื่อที่คล้ายกัน · ทุกการจับคู่มีคนตัดสินใจและบันทึกไว้ว่าใครทำเมื่อไร";

/** The label used wherever a Brand appears on a Page surface. */
export const BRAND_ON_PAGE_LABEL = "Brand (จัดกลุ่มโดย PT Glory)";

export const UNMAPPED_MEANING =
  "เพจที่ยังไม่ถูกจับคู่กับแบรนด์ ไม่ใช่ข้อผิดพลาดของข้อมูล และไม่ใช่คุณภาพข้อมูลต่ำ " +
  "— เป็นคิวงานที่ยังไม่มีใครตรวจ";

/**
 * What a Brand-level ad count means, and the three things it does not.
 *
 * Membership is the mapping as it stands TODAY. A Page that moved here last
 * week brings its ads with it, so this is not a historical attribution — and it
 * is not spend, reach or share of anything.
 */
export const BRAND_ADS_BASIS =
  "นับโฆษณาที่ไม่ซ้ำกัน (ad_archive_id) จากเพจที่จับคู่อยู่กับแบรนด์นี้ ณ ตอนนี้ " +
  "ในขอบเขตข้อมูลที่เลือก · ไม่ใช่ตัวเลขย้อนหลังตามประวัติการจับคู่ และไม่ใช่ส่วนแบ่งตลาด";

export const MOVE_EXPLANATION =
  "ย้ายเพจนี้ไปแบรนด์ใหม่ · การจับคู่เดิมจะถูกปิดตามเวลา และยังอยู่ในประวัติ " +
  "ไม่ใช่การรวมแบรนด์เข้าด้วยกัน";

export const UNMAP_EXPLANATION =
  "เลิกจับคู่เพจนี้ · ประวัติเดิมยังอยู่ครบ และเพจจะกลับไปอยู่ในคิวที่ยังไม่จับคู่";

export const ARCHIVE_EXPLANATION =
  "เก็บแบรนด์นี้เข้าคลัง · ประวัติการจับคู่ทั้งหมดยังอยู่ แต่จะจับคู่เพจใหม่เข้าแบรนด์นี้ไม่ได้ " +
  "จนกว่าจะเปิดใช้งานอีกครั้ง";

export const DUPLICATE_EXPLANATION =
  "มีแบรนด์ชื่อนี้อยู่แล้ว (เทียบแบบตัดช่องว่างและตัวพิมพ์) — เลือกแบรนด์เดิม " +
  "หรือตั้งชื่อที่แยกความต่างได้ ระบบไม่รวมให้อัตโนมัติ";
