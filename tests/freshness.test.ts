import assert from "node:assert/strict";
import test from "node:test";
import {
  SOURCE_URL_DAYS, collectionAge, freshnessNote,
} from "../lib/domain/freshness.ts";

/**
 * How old the data is, said where a working day starts.
 *
 * The point is not to nag. Numbers collected two weeks ago are exactly as true
 * as they were that day — what changes is the question they can answer, and a
 * newcomer opening an empty trend screen deserves to know why rather than
 * concluding the product is broken.
 */

const NOW = new Date("2026-09-10T12:00:00.000Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000).toISOString();

test("age is counted from collection, not from import", () => {
  assert.equal(collectionAge(daysAgo(0), NOW), 0);
  assert.equal(collectionAge(daysAgo(3), NOW), 3);
  assert.equal(collectionAge(daysAgo(30), NOW), 30);
  // A clock that ran backwards is not negative age.
  assert.equal(collectionAge(new Date(NOW.getTime() + 86_400_000).toISOString(), NOW), 0);
});

test("nothing collected is its own case, not zero days old", () => {
  assert.equal(collectionAge(null, NOW), null);
  assert.equal(collectionAge("not-a-date", NOW), null);
  const note = freshnessNote(null);
  assert.equal(note?.level, "note");
  assert.match(note!.text, /ยังไม่มีรอบเก็บข้อมูล/);
});

test("fresh data says nothing at all", () => {
  // A note on every visit is a note nobody reads.
  assert.equal(freshnessNote(0), null);
  assert.equal(freshnessNote(1), null);
});

test("a few days in, it explains what regular collection buys", () => {
  const note = freshnessNote(2);
  assert.equal(note?.level, "note");
  assert.match(note!.text, /ไทม์ไลน์ แนวโน้ม และรายการติดตาม/);
});

test("past the source-URL window it warns, and says why that window exists", () => {
  const note = freshnessNote(SOURCE_URL_DAYS);
  assert.equal(note?.level, "warn");
  assert.match(note!.text, /ลิงก์รูป/);
  // The consequence stated plainly: text imports, images do not.
  assert.match(note!.text, /เก็บรูปไม่ทัน/);
});

test("old data is called old, never called wrong", () => {
  const note = freshnessNote(30);
  assert.equal(note?.level, "warn");
  assert.match(note!.text, /ตัวเลขยังถูกต้องตามวันที่เก็บ/);
  assert.match(note!.text, /ไม่ได้บอกสถานะตลาดวันนี้/);
});

test("no wording here invents a metric", () => {
  const forbidden = /spend|reach|impression|engagement|ctr|cpc|roas|ส่วนแบ่งตลาด|งบโฆษณา/i;
  for (const age of [null, 0, 2, 4, 14, 90]) {
    const note = freshnessNote(age);
    if (note) assert.ok(!forbidden.test(note.text), String(age));
  }
});
