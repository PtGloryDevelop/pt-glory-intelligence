import assert from "node:assert/strict";
import test from "node:test";
import { twoClockNote, type ClockFigures } from "../lib/domain/clocks.ts";

/**
 * "We just found it" and "it has run for months" are both true.
 *
 * Found on the pilot: a page showed พบใหม่ 28 beside Evergreen 15, which reads
 * as a contradiction until you know the first counts our sightings and the
 * second counts Meta's start dates. Each card explained itself; neither
 * explained the other.
 */

const date = (value: string | null) => (value ? "7 ก.ย. 2569" : "—");

const base: ClockFigures = {
  observed: 28, recentlyFound: 28, startedRecently: 6, evergreen: 15,
  recentDays: 30, firstObservedAt: "2026-09-07T05:23:00.000Z",
};

test("the note names our clock, not the advertiser's", () => {
  const note = twoClockNote(base, date);
  assert.ok(note);
  assert.match(note, /จากวันที่ “เรา” เห็นครั้งแรก/);
  assert.match(note, /ไม่ใช่วันที่เพจเริ่มยิงโฆษณา/);
});

test("it uses the figures actually on screen", () => {
  const note = twoClockNote(base, date)!;
  // Generic help text gets skipped; these numbers are the ones the reader is
  // looking at, so they are the ones that make the sentence land.
  assert.match(note, /ทั้ง 28 รายการ/);
  assert.match(note, /15 รายการในนั้นอายุถึงเกณฑ์ Evergreen/);
  assert.match(note, /มีเพียง 6 รายการที่เริ่มแสดงในช่วงเดียวกัน/);
  assert.match(note, /เราเริ่มเก็บข้อมูลเพจนี้เมื่อ 7 ก.ย. 2569/);
});

test("only part of the page being new is described as part", () => {
  const note = twoClockNote({ ...base, recentlyFound: 9 }, date)!;
  assert.match(note, /9 รายการ/);
  assert.ok(!note.includes("ทั้ง 28"), "only 9 of them are new to us");
});

test("nothing new to us needs no explanation", () => {
  assert.equal(twoClockNote({ ...base, recentlyFound: 0 }, date), null);
});

test("no contradiction, no note", () => {
  // Everything we found recently also started recently, and none is evergreen:
  // the two clocks agree here, so there is nothing to reconcile.
  const agreed = { ...base, recentlyFound: 6, startedRecently: 6, evergreen: 0 };
  assert.equal(twoClockNote(agreed, date), null);
});

test("evergreen alone is enough to warrant the note", () => {
  const note = twoClockNote(
    { ...base, recentlyFound: 6, startedRecently: 6, evergreen: 3 }, date,
  );
  assert.ok(note);
  assert.match(note, /3 รายการในนั้นอายุถึงเกณฑ์ Evergreen/);
});

test("an unknown first-observed date drops the clause rather than guessing", () => {
  const note = twoClockNote({ ...base, firstObservedAt: null }, date)!;
  assert.ok(!note.includes("เพราะเราเริ่มเก็บ"));
  // The rest of the explanation still stands on its own.
  assert.match(note, /จากวันที่ “เรา” เห็นครั้งแรก/);
});

test("the note claims no metric this product does not have", () => {
  const forbidden = /spend|reach|impression|engagement|ctr|cpc|roas|ยอดขาย|ส่วนแบ่งตลาด/i;
  const note = twoClockNote(base, date)!;
  assert.ok(!forbidden.test(note));
  // Evergreen is duration, never performance.
  assert.ok(!/ปัง|ได้ผล|ดีที่สุด/.test(note));
});
