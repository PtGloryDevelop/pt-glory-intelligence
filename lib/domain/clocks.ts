/**
 * Why "we just found it" and "it has run for months" are both true.
 *
 * A Page screen puts these side by side:
 *
 *   พบใหม่ใน 30 วัน   28     ← our clock: when PT Glory first saw the ad
 *   Evergreen         15     ← Meta's clock: how long Meta says it has run
 *
 * Each card explains itself. Neither explains the other, so a reader meets
 * "we found all 28 this month" beside "15 have run over 90 days" and concludes
 * one of them is broken. Both are right: we started collecting this page
 * recently, and the ads were already old when we arrived.
 *
 * The sentence below is deliberately specific rather than general help text.
 * "These two use different clocks" gets skipped; the actual numbers, with the
 * date collection started, gets read.
 */

export type ClockFigures = {
  observed: number;
  /** First seen by us, inside the recent window. */
  recentlyFound: number;
  /** Meta's own start date inside the same window. */
  startedRecently: number;
  /** Still running, and old enough by Meta's start date. */
  evergreen: number;
  recentDays: number;
  /** The first run that saw this page at all. */
  firstObservedAt: string | null;
};

/**
 * The note this particular set of figures needs, or null when nothing about
 * them invites the wrong reading.
 */
export function twoClockNote(figures: ClockFigures, formatDate: (value: string | null) => string): string | null {
  const { observed, recentlyFound, startedRecently, evergreen, recentDays } = figures;
  if (recentlyFound === 0) return null;

  // The contradiction only appears when something we "just found" turns out to
  // have been running for a long time.
  const looksContradictory = evergreen > 0 || startedRecently < recentlyFound;
  if (!looksContradictory) return null;

  const since = figures.firstObservedAt
    ? ` เพราะเราเริ่มเก็บข้อมูลเพจนี้เมื่อ ${formatDate(figures.firstObservedAt)}`
    : "";

  const all = recentlyFound === observed && observed > 0;
  const scope = all
    ? `ทั้ง ${observed.toLocaleString("th-TH")} รายการ`
    : `${recentlyFound.toLocaleString("th-TH")} รายการ`;

  const parts = [
    `“พบใหม่ใน ${recentDays} วัน” นับ${scope}นี้จากวันที่ “เรา” เห็นครั้งแรก ` +
    "ไม่ใช่วันที่เพจเริ่มยิงโฆษณา",
  ];

  if (evergreen > 0) {
    parts.push(
      `${evergreen.toLocaleString("th-TH")} รายการในนั้นอายุถึงเกณฑ์ Evergreen ` +
      "ตามวันที่ Meta ระบุ — คือยิงมานานแล้วก่อนที่เราจะเก็บเจอ",
    );
  }
  if (startedRecently < recentlyFound) {
    parts.push(
      `Meta ระบุว่ามีเพียง ${startedRecently.toLocaleString("th-TH")} รายการที่เริ่มแสดงในช่วงเดียวกัน`,
    );
  }

  return `${parts.join(" · ")}${since}`;
}
