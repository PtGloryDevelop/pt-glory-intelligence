import assert from "node:assert/strict";
import test from "node:test";
import { launchPace, mostReused, offerSignals, weekStartOf } from "../lib/pages/summary.ts";

/**
 * The summary at the top of a rival page reads only stored copy and stored dates.
 * These pin what it finds and what it refuses to count.
 */

const kivari = "💥 โปรแรง 1 แถม 1 ราคา 390 บาท ส่งฟรี | เก็บเงินปลายทาง สนใจพิมพ์ “สนใจ”";

test("offers are counted once per ad, against the ads that had copy", () => {
  const summary = offerSignals([
    { title: null, body_text: kivari },
    { title: "ซอฟต์เจลเดียวจบ", body_text: `${kivari} 1 แถม 1 อีกครั้ง` },
    { title: null, body_text: "2แถม1 ส่งฟรีทั่วไทย ราคาเพียง 1,300 บาท" },
    { title: null, body_text: null },
  ]);
  assert.equal(summary.readable, 3);
  assert.deepEqual(summary.offers.find((o) => o.label === "1 แถม 1"), { label: "1 แถม 1", ads: 2 });
  assert.deepEqual(summary.offers.find((o) => o.label === "2 แถม 1"), { label: "2 แถม 1", ads: 1 });
  assert.deepEqual(summary.offers.find((o) => o.label === "ส่งฟรี"), { label: "ส่งฟรี", ads: 3 });
  assert.deepEqual(summary.offers.find((o) => o.label === "เก็บเงินปลายทาง"), { label: "เก็บเงินปลายทาง", ads: 2 });
  assert.deepEqual(summary.prices, [{ baht: 390, ads: 2 }, { baht: 1300, ads: 1 }]);
});

test("numbers that are not baht are not prices", () => {
  const summary = offerSignals([{ title: null, body_text: "ดูดซึมเร็ว 20 เท่า เห็นผลใน 7 วัน LDL 390 ลด 30% วันนี้" }]);
  assert.deepEqual(summary.prices, []);
  assert.deepEqual(summary.offers, [{ label: "ลด 30%", ads: 1 }]);
});

test("written prices take the common Thai forms", () => {
  const summary = offerSignals([
    { title: null, body_text: "เซ็ต 3 กล่อง 750.-" },
    { title: null, body_text: "เหลือ ฿590" },
    { title: null, body_text: "ราคาพิเศษ 1,800" },
  ]);
  assert.deepEqual(summary.prices.map((p) => p.baht).sort((a, b) => a - b), [590, 750, 1800]);
});

test("weeks follow the database calendar: Monday, UTC", () => {
  assert.equal(weekStartOf(Date.parse("2026-10-22T04:00:00Z")), "2026-10-19");
  assert.equal(weekStartOf(Date.parse("2026-10-19T00:00:00Z")), "2026-10-19");
  assert.equal(weekStartOf(Date.parse("2026-10-18T23:59:59Z")), "2026-10-12");
});

test("launch pace lists the last four weeks and averages only the finished ones", () => {
  const pace = launchPace([
    { bucket_start: "2026-09-28T00:00:00+00:00", started_ads: 12 },
    { bucket_start: "2026-10-05T00:00:00+00:00", started_ads: 7 },
    { bucket_start: "2026-10-19T00:00:00+00:00", started_ads: 12 },
    { bucket_start: "2026-09-21T00:00:00+00:00", started_ads: 40 },
  ], Date.parse("2026-10-22T04:00:00Z"));
  assert.deepEqual(pace.weeks.map((w) => [w.weekStart, w.started, w.current]), [
    ["2026-09-28", 12, false], ["2026-10-05", 7, false], ["2026-10-12", 0, false], ["2026-10-19", 12, true],
  ]);
  // A week with no starts is a zero, not a gap; the week before the window is not counted.
  assert.equal(pace.average, (12 + 7 + 0) / 3);
});

test("the most reused creative needs a shared creative at all", () => {
  assert.equal(mostReused([{ collation_count: 1 }, { collation_count: null }]), null);
  assert.deepEqual(mostReused([{ collation_count: 3 }, { collation_count: 18 }, { collation_count: 18 }]), { collation_count: 18 });
});
