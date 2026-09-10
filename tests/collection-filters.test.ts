import assert from "node:assert/strict";
import test from "node:test";
import {
  collectionFilterSummary, statusFilterNote, type CollectionFilters,
} from "../lib/domain/collection-filters.ts";

/**
 * The sentence that stops a zero from lying.
 *
 * Found in the pilot: a page showed `Active 28 · Inactive 0 · ไม่ทราบ 0` from
 * two runs collected with active_status = active. Nothing on screen said the
 * search had excluded stopped ads, so the zero read as a fact about the
 * advertiser instead of a fact about the question.
 */

const base: CollectionFilters = {
  runs: 2, active_status: null, ad_type: "all", media_type: "all",
  countries: ["TH"], queries: ["วิตามินสลายไขมัน"],
};

test("an unconstrained search needs no caveat", () => {
  // The counts stand on their own here: every status was eligible to appear.
  assert.equal(statusFilterNote({ ...base, active_status: "all" }), null);
  assert.equal(statusFilterNote({ ...base, active_status: null }), null);
  assert.equal(statusFilterNote(null), null);
});

test("an active-only search says what its zeros mean", () => {
  const note = statusFilterNote({ ...base, active_status: "active" });
  assert.ok(note);
  assert.match(note, /ขอเฉพาะโฆษณาที่ยังแสดงอยู่/);
  // The distinction the reader would otherwise get wrong.
  assert.match(note, /ไม่ใช่ข้อค้นพบเกี่ยวกับเพจ/);
  assert.match(note, /ผลจากคำค้นที่เราตั้งไว้/);
});

test("an inactive-only search is qualified the same way, in reverse", () => {
  const note = statusFilterNote({ ...base, active_status: "inactive" });
  assert.ok(note);
  assert.match(note, /ขอเฉพาะโฆษณาที่หยุดแล้ว/);
  assert.match(note, /ไม่ใช่ข้อค้นพบเกี่ยวกับเพจ/);
});

test("runs that disagree are not summarised as though they agreed", () => {
  const note = statusFilterNote({ ...base, active_status: "mixed" });
  assert.ok(note);
  assert.match(note, /ใช้ตัวกรองสถานะต่างกัน/);
  assert.match(note, /เทียบกันตรง ๆ ไม่ได้/);
});

test("an unfamiliar filter is reported, not interpreted", () => {
  // A future collector value must not be silently treated as "no filter".
  const note = statusFilterNote({ ...base, active_status: "archived_only" });
  assert.ok(note);
  assert.match(note, /archived_only/);
  assert.match(note, /อ่านได้เฉพาะภายใต้ตัวกรองนี้/);
});

test("the summary states the search without inventing one", () => {
  assert.equal(
    collectionFilterSummary({ ...base, active_status: "active" }),
    "สถานะ active · TH",
  );
  // "all" carries no information, so it is not repeated back as though it did.
  assert.equal(
    collectionFilterSummary({ ...base, active_status: null, countries: [] }),
    "ไม่ได้กรอง",
  );
  assert.equal(collectionFilterSummary({ ...base, runs: 0 }), "—");
  assert.equal(collectionFilterSummary(null), "—");
});

test("no wording here promises a metric this product does not have", () => {
  const forbidden = /spend|reach|impression|engagement|ctr|cpc|roas|ส่วนแบ่งตลาด|งบโฆษณา/i;
  for (const status of ["active", "inactive", "mixed", "weird"]) {
    const note = statusFilterNote({ ...base, active_status: status });
    assert.ok(note && !forbidden.test(note), status);
  }
});
