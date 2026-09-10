import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { NOT_COLLECTED, changeOf, pointChange, share } from "../lib/trends/periods.ts";

/**
 * A period that was never collected has no share, so nothing moved.
 *
 * Found on the pilot: the previous window held no collection run, and the mix
 * tables still printed `0.0%` for it and `+42.0 pp` beside it. Both look
 * measured. Neither is — there was no denominator, so there was no share, so
 * there was no movement between shares. A reader screenshotting "+42 pp" would
 * be quoting our collection schedule as though it were the market.
 */

test("a share needs a denominator", () => {
  assert.equal(share(10, 0), 0);
  assert.equal(share(0, 0), 0);
  // The number is only meaningful once something was counted.
  assert.equal(share(5, 10), 50);
});

test("arithmetic still works; presentation is what changes", () => {
  // pointChange is not wrong — it is simply the wrong question when the
  // previous period is absent, which is why the screens decide, not this.
  assert.equal(pointChange(42, 0).label, "+42.0 pp");
  assert.equal(pointChange(0, 0).label, "ไม่เปลี่ยน");
});

test("a change from zero is never a percentage", () => {
  const change = changeOf(882, 0);
  assert.equal(change.percent, null, "a base of zero has no percentage");
  assert.match(change.label, /จาก 0 เป็น 882/);
  assert.match(change.label, /ในข้อมูลที่เราพบ/);
});

test("one word for an uncollected period, defined once", () => {
  assert.equal(NOT_COLLECTED, "ไม่ได้เก็บ");
  // Two screens inventing their own wording is how two screens come to disagree.
  const mix = readFileSync(join("components", "TrendMix.tsx"), "utf8");
  const trends = readFileSync(join("app", "(app)", "trends", "page.tsx"), "utf8");
  assert.match(mix, /NOT_COLLECTED/);
  assert.match(trends, /NOT_COLLECTED/);
});

test("the mix table refuses to compute against an uncollected period", () => {
  const mix = readFileSync(join("components", "TrendMix.tsx"), "utf8");
  // The flag is required, not inferred from a zero: a real zero share and an
  // absent one are different facts that happen to render alike.
  assert.match(mix, /previousCollected: boolean/);
  assert.match(mix, /previousCollected \? points\.label/);
  assert.match(mix, /period === "previous" && !previousCollected/);
});

test("the page ranking refuses the same comparison", () => {
  const trends = readFileSync(join("app", "(app)", "trends", "page.tsx"), "utf8");
  assert.match(trends, /ยังเทียบไม่ได้/);
  // Every mix on the page is told, rather than some of them.
  const passes = [...trends.matchAll(/previousCollected=\{previousContext\.length > 0\}/g)];
  assert.equal(passes.length, 3, "each TrendMix must be told whether the period exists");
});
