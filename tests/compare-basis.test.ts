import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { COMPARE_BASIS, COMPARE_SCOPE_HINT } from "../lib/compare/contract.ts";

/**
 * Compare was the only screen without an opening sentence.
 *
 * Every other surface says what it is showing and what it refuses to conclude.
 * Compare had a chooser, then eight hundred pixels of nothing — so a first-time
 * reader had no way to learn what putting two pages side by side would tell
 * them, or what it would not.
 */

test("the basis says what a comparison is made of", () => {
  assert.match(COMPARE_BASIS, /ขอบเขตข้อมูลเดียวกัน/);
  assert.match(COMPARE_BASIS, /ผลต่างของสิ่งที่เราเก็บมาได้/);
});

test("and refuses the conclusion a reader will otherwise draw", () => {
  assert.match(COMPARE_BASIS, /ไม่ตัดสินว่าใครดีกว่า/);
  // The specific wrong inference, named: more ads found is not more sales.
  assert.match(COMPARE_BASIS, /ไม่ได้แปลว่าขายดีกว่า/);
});

test("the scope hint explains why a scope comes first", () => {
  assert.match(COMPARE_SCOPE_HINT, /คนละคำถาม/);
});

test("neither promises a metric this product does not have", () => {
  // "ใช้งบมากกว่า" appears as a refusal, so denials are stripped before scanning.
  const denials = /ไม่ได้แปลว่าขายดีกว่า ใช้งบมากกว่า หรือได้ผลดีกว่า/g;
  const forbidden = /spend|reach|impression|ctr|cpc|roas|ส่วนแบ่งตลาด/i;
  for (const text of [COMPARE_BASIS, COMPARE_SCOPE_HINT]) {
    assert.ok(!forbidden.test(text.replace(denials, "")), text);
  }
});

test("the screen renders the basis and offers a way forward", () => {
  const page = readFileSync(join("app", "(app)", "compare", "page.tsx"), "utf8");
  assert.match(page, /COMPARE_BASIS/);
  assert.match(page, /COMPARE_SCOPE_HINT/);
  // A shortcut that states its own rule rather than implying a recommendation.
  assert.match(page, /เรียงตามจำนวน Ads ที่เราเก็บเจอ/);
  assert.match(page, /compare-top-two/);
  // And a scope with fewer than two pages says so instead of offering nothing.
  assert.match(page, /compare-not-enough-pages/);
});

test("the mapping queue shows how much of the work is done", () => {
  const queue = readFileSync(join("app", "(app)", "unmapped-pages", "page.tsx"), "utf8");
  assert.match(queue, /unmapped-progress/);
  // Derived, not stored: pages the scope has seen minus those still queued.
  assert.match(queue, /inScope - queue\.total/);
});
