/**
 * How old the picture is.
 *
 * Half of this product — the timeline, trends, the watchlist, "พบใหม่" — only
 * says anything once there are several collections spread over time. A single
 * run, however recent, leaves those screens correctly reporting that they have
 * nothing to compare, which reads to a newcomer as a broken product.
 *
 * So the age is stated where a working day starts, in the one clock that
 * matters: when the data was COLLECTED. A three-day-old export uploaded this
 * morning is three days old, and every temporal surface reads it that way.
 */

/** Signed URLs in a fresh export have lasted about this long in practice. */
export const SOURCE_URL_DAYS = 4;

export type Freshness = { level: "ok" | "note" | "warn"; text: string };

const DAY = 24 * 60 * 60 * 1000;

/** Whole days between a collection and now. Null when nothing was collected. */
export function collectionAge(collectedAt: string | null, now = new Date()): number | null {
  if (!collectedAt) return null;
  const then = new Date(collectedAt);
  if (Number.isNaN(then.getTime())) return null;
  return Math.max(0, Math.floor((now.getTime() - then.getTime()) / DAY));
}

/**
 * What to say about that age, if anything.
 *
 * Deliberately not an alert. Nothing here is wrong when data is old — the
 * numbers stay exactly as true as they were on the day they were collected.
 * What changes is what they can answer, and that is worth saying out loud
 * rather than leaving somebody to wonder why a trend is empty.
 */
export function freshnessNote(age: number | null): Freshness | null {
  if (age === null) {
    return {
      level: "note",
      text: "ยังไม่มีรอบเก็บข้อมูลในระบบ — นำเข้าไฟล์ export หนึ่งไฟล์เพื่อเริ่ม",
    };
  }
  if (age >= 14) {
    return {
      level: "warn",
      text: `ข้อมูลล่าสุดอายุ ${age} วัน — ตัวเลขยังถูกต้องตามวันที่เก็บ ` +
        "แต่ไม่ได้บอกสถานะตลาดวันนี้ และไทม์ไลน์กับแนวโน้มจะเทียบได้เฉพาะช่วงที่เคยเก็บไว้",
    };
  }
  if (age >= SOURCE_URL_DAYS) {
    return {
      level: "warn",
      text: `ข้อมูลล่าสุดอายุ ${age} วัน — ถึงรอบเก็บใหม่แล้ว ` +
        `ลิงก์รูปในไฟล์ export มีอายุราว ${SOURCE_URL_DAYS} วัน ` +
        "ไฟล์ที่เก่ากว่านั้นจะนำเข้าข้อความได้แต่เก็บรูปไม่ทัน",
    };
  }
  if (age >= 2) {
    return {
      level: "note",
      text: `ข้อมูลล่าสุดอายุ ${age} วัน — เก็บสม่ำเสมอทุก 3–4 วัน ` +
        "จะทำให้ไทม์ไลน์ แนวโน้ม และรายการติดตามมีของให้เทียบ",
    };
  }
  return null;
}
