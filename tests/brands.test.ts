import assert from "node:assert/strict";
import test from "node:test";
import {
  ARCHIVE_EXPLANATION, BRAND_ADS_BASIS, BRAND_BASIS, BRAND_ON_PAGE_LABEL,
  BRAND_STATUSES, DUPLICATE_EXPLANATION, MAX_BRAND_NAME, MOVE_EXPLANATION,
  STATUS_LABEL, UNMAPPED_MEANING, UNMAPPED_SORTS, UNMAPPED_SORT_LABEL,
  UNMAP_EXPLANATION, brandName, brandStatus, optionalText, unmappedSort,
} from "../lib/brands/contract.ts";

/**
 * The Brand vocabulary, tested away from the database.
 *
 * Three claims carry the risk. That a Brand is a human decision and not
 * something the system worked out. That an unmapped Page is unreviewed work
 * rather than bad data. And that a Brand-level number is bounded by a scope and
 * by today's mappings — not a share of any market.
 */

test("a brand name is validated, never normalized here", () => {
  assert.deepEqual(brandName("  Glory Thailand  "), { ok: true, value: "Glory Thailand" });
  assert.equal(brandName("").ok, false);
  assert.equal(brandName("   ").ok, false);
  assert.equal(brandName(null).ok, false);
  assert.equal(brandName("x".repeat(MAX_BRAND_NAME + 1)).ok, false);

  /*
   * Deliberately NOT normalized in TypeScript. `brand_normalized_name` in SQL
   * decides uniqueness; a second copy here would drift and then disagree with
   * the index that actually enforces it.
   */
  assert.deepEqual(brandName("Glory  THAILAND"), { ok: true, value: "Glory  THAILAND" });
});

test("optional text is trimmed to null, not to an empty string", () => {
  assert.deepEqual(optionalText("   ", 100), { ok: true, value: null });
  assert.deepEqual(optionalText(undefined, 100), { ok: true, value: null });
  assert.deepEqual(optionalText(" note ", 100), { ok: true, value: "note" });
  assert.equal(optionalText("x".repeat(101), 100).ok, false);
  assert.equal(optionalText(42, 100).ok, false);
});

test("a brand is active or archived, and nothing else", () => {
  assert.deepEqual([...BRAND_STATUSES], ["active", "archived"]);
  assert.equal(brandStatus("active"), "active");
  assert.equal(brandStatus("deleted"), null);
  assert.equal(brandStatus(null), null);
  for (const status of BRAND_STATUSES) assert.ok(STATUS_LABEL[status].length > 0);
});

test("the review queue orders by observation, never by likelihood", () => {
  assert.deepEqual([...UNMAPPED_SORTS], [
    "observed_ads", "recently_found", "last_observed", "page_name",
  ]);
  assert.equal(unmappedSort("page_name"), "page_name");
  // An unknown sort falls back rather than reaching SQL.
  assert.equal(unmappedSort("likely_brand"), "observed_ads");
  assert.equal(unmappedSort(null), "observed_ads");

  const forbidden = /confidence|likely|probable|น่าจะ|ความมั่นใจ|คะแนน/i;
  for (const sort of UNMAPPED_SORTS) {
    assert.ok(!forbidden.test(sort), sort);
    assert.ok(!forbidden.test(UNMAPPED_SORT_LABEL[sort]), sort);
  }
});

/* -------------------------------------------------------------- vocabulary */

const SURFACES = [
  BRAND_BASIS, BRAND_ADS_BASIS, BRAND_ON_PAGE_LABEL, UNMAPPED_MEANING,
  MOVE_EXPLANATION, UNMAP_EXPLANATION, ARCHIVE_EXPLANATION, DUPLICATE_EXPLANATION,
];

test("nothing in the wording promises inference", () => {
  // A denial is not a promise: the basis has to be able to say it does NOT
  // guess from similar names, so denials are removed before the scan.
  const denials = /ไม่ได้เดาจากชื่อที่คล้ายกัน|ไม่รวมให้อัตโนมัติ/g;
  const forbidden = /AI|อัตโนมัติ|เดา|จับคู่ให้|แนะนำแบรนด์|confidence|fuzzy|น่าจะเป็น/i;
  for (const text of SURFACES) {
    assert.ok(!forbidden.test(text.replace(denials, "")), `"${text}" implies inference`);
  }
  // ...and the basis says outright who decided.
  assert.match(BRAND_BASIS, /โดยทีม PT Glory เอง/);
  assert.match(BRAND_BASIS, /ไม่ใช่ข้อมูลจาก Meta/);
  assert.match(BRAND_BASIS, /ใครทำเมื่อไร/);
});

test("no brand surface names a metric this product does not have", () => {
  const forbidden =
    /spend|reach|impression|engagement|ctr|cpc|cpa|roas|conversion|market share|share of voice|ส่วนแบ่งตลาด|งบโฆษณา/i;
  for (const text of SURFACES) {
    // The ads basis is allowed to refuse "ส่วนแบ่งตลาด" by name.
    const claims = text.replace(/ไม่ใช่ส่วนแบ่งตลาด/g, "");
    assert.ok(!forbidden.test(claims), `"${text}" names a metric that does not exist`);
  }
});

test("a brand on a page surface says who grouped it", () => {
  // The label exists so a Brand can never be mistaken for a Meta field.
  assert.match(BRAND_ON_PAGE_LABEL, /PT Glory/);
  assert.match(BRAND_ON_PAGE_LABEL, /Brand/);
});

test("an unmapped page is a queue, not a defect", () => {
  assert.match(UNMAPPED_MEANING, /ไม่ใช่ข้อผิดพลาด/);
  // Explicitly not a data-quality tier: coverage language means something else
  // in this product and must not be borrowed for human work.
  assert.match(UNMAPPED_MEANING, /ไม่ใช่คุณภาพข้อมูลต่ำ/);
  assert.match(UNMAPPED_MEANING, /คิวงาน/);
});

test("a brand ad count states its scope and its membership rule", () => {
  assert.match(BRAND_ADS_BASIS, /ad_archive_id/);
  assert.match(BRAND_ADS_BASIS, /ณ ตอนนี้/);
  assert.match(BRAND_ADS_BASIS, /ขอบเขตข้อมูลที่เลือก/);
  // The two readings it refuses outright.
  assert.match(BRAND_ADS_BASIS, /ไม่ใช่ตัวเลขย้อนหลัง/);
  assert.match(BRAND_ADS_BASIS, /ไม่ใช่ส่วนแบ่งตลาด/);
});

test("a move is a move, and never called a merge", () => {
  assert.match(MOVE_EXPLANATION, /ยังอยู่ในประวัติ/);
  assert.match(MOVE_EXPLANATION, /ไม่ใช่การรวมแบรนด์/);
  assert.ok(!/merge/i.test(MOVE_EXPLANATION));
});

test("unmapping and archiving both keep the history", () => {
  assert.match(UNMAP_EXPLANATION, /ประวัติเดิมยังอยู่ครบ/);
  assert.match(UNMAP_EXPLANATION, /กลับไปอยู่ในคิว/);
  assert.match(ARCHIVE_EXPLANATION, /ประวัติการจับคู่ทั้งหมดยังอยู่/);
  assert.match(ARCHIVE_EXPLANATION, /จับคู่เพจใหม่เข้าแบรนด์นี้ไม่ได้/);
});

test("a duplicate name is shown, not resolved", () => {
  assert.match(DUPLICATE_EXPLANATION, /มีแบรนด์ชื่อนี้อยู่แล้ว/);
  assert.match(DUPLICATE_EXPLANATION, /เลือกแบรนด์เดิม/);
  // The one thing the system must never do on its own.
  assert.match(DUPLICATE_EXPLANATION, /ไม่รวมให้อัตโนมัติ/);
});
