import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_PAGE_SORT, DEFAULT_RECENT_DAYS, PAGE_SIGNALS, PAGE_SORTS,
  pageSignal, pageSortKey, parseScope, recentDays, scopeArgs, scopeBasis,
  scopeLabel, scopeToParam,
} from "../lib/pages/scope.ts";
import { coverageOf, formatShare, share } from "../lib/domain/coverage-language.ts";

/**
 * The rules Page Intelligence rests on, tested away from the database.
 *
 * Two of them are the ones most likely to be quietly broken by a later change:
 * that a scope is always explicit, and that a percentage computed over part of
 * the data says so.
 */

test("a scope is explicit or it is nothing", () => {
  assert.deepEqual(parseScope("all"), { kind: "all" });
  assert.deepEqual(
    parseScope("dataset:0b6e1f7c-9c1a-4f3e-8b2d-1a2b3c4d5e6f"),
    { kind: "dataset", id: "0b6e1f7c-9c1a-4f3e-8b2d-1a2b3c4d5e6f" },
  );
  assert.deepEqual(
    parseScope("category:0b6e1f7c-9c1a-4f3e-8b2d-1a2b3c4d5e6f"),
    { kind: "category", id: "0b6e1f7c-9c1a-4f3e-8b2d-1a2b3c4d5e6f" },
  );

  // No scope is not "everything". A surface with no scope has not been asked a
  // question it can answer, and must say so rather than widen silently.
  assert.equal(parseScope(null), null);
  assert.equal(parseScope(""), null);
  assert.equal(parseScope("everything"), null);
  assert.equal(parseScope("dataset:not-a-uuid"), null);
  assert.equal(parseScope("dataset:"), null);
  // An id without a kind cannot say which table it belongs to.
  assert.equal(parseScope("0b6e1f7c-9c1a-4f3e-8b2d-1a2b3c4d5e6f"), null);
});

test("a scope survives the round trip through a URL", () => {
  for (const raw of ["all", "dataset:0b6e1f7c-9c1a-4f3e-8b2d-1a2b3c4d5e6f"]) {
    assert.equal(scopeToParam(parseScope(raw)!), raw);
  }
});

test("the SQL arguments carry the scope, and only ever one id", () => {
  assert.deepEqual(scopeArgs({ kind: "all" }), { p_scope: "all", p_scope_id: null });
  assert.deepEqual(
    scopeArgs({ kind: "category", id: "0b6e1f7c-9c1a-4f3e-8b2d-1a2b3c4d5e6f" }),
    { p_scope: "category", p_scope_id: "0b6e1f7c-9c1a-4f3e-8b2d-1a2b3c4d5e6f" },
  );
});

test("only a dataset scope claims to be a snapshot", () => {
  assert.match(scopeBasis({ kind: "dataset", id: "x" }), /รอบเก็บของ Dataset นี้/);
  for (const scope of [{ kind: "all" } as const, { kind: "category", id: "x" } as const]) {
    const basis = scopeBasis(scope);
    assert.match(basis, /สังเกตล่าสุด/);
    // The wider scopes must not be describable as a dataset snapshot.
    assert.match(basis, /ไม่ใช่ snapshot/);
  }
});

test("the scope label names the dataset or category, never invents one", () => {
  assert.equal(scopeLabel({ kind: "all" }), "ทุกข้อมูลที่เก็บมา");
  assert.equal(scopeLabel({ kind: "dataset", id: "abc" }, "golden-journey"), "Dataset: golden-journey");
  // With no name to hand, the id is shown rather than a friendly guess.
  assert.equal(scopeLabel({ kind: "dataset", id: "abc" }), "Dataset: abc");
});

test("sort and signal are allowlists, not free text", () => {
  assert.equal(pageSortKey(undefined), DEFAULT_PAGE_SORT);
  assert.equal(pageSortKey("page_name"), "page_name");
  // An unrecognised key is refused, not silently defaulted: a shared research
  // URL that quietly reorders itself is worse than one that says it is wrong.
  assert.equal(pageSortKey("observed_ads; drop table ads"), null);
  assert.equal(pageSortKey("spend"), null);

  assert.equal(pageSignal("evergreen"), "evergreen");
  assert.equal(pageSignal("winning"), null);
  assert.equal(pageSignal(null), null);
});

test("no sort or signal names a metric this product does not have", () => {
  const forbidden = /spend|reach|impression|engagement|ctr|cpc|cpa|roas|conversion|winning|top|best/i;
  for (const option of PAGE_SORTS) {
    assert.ok(!forbidden.test(option.key), `sort ${option.key} names an unsupported metric`);
    assert.ok(!forbidden.test(option.label), `sort label ${option.label} names an unsupported metric`);
  }
  for (const signal of PAGE_SIGNALS) {
    assert.ok(!forbidden.test(signal), `signal ${signal} names an unsupported metric`);
  }
});

test("the recent window is one of the offered ones", () => {
  assert.equal(recentDays("7"), 7);
  assert.equal(recentDays("14"), 14);
  assert.equal(recentDays("30"), 30);
  // Anything else falls back rather than reaching SQL as an arbitrary interval.
  assert.equal(recentDays("9999"), DEFAULT_RECENT_DAYS);
  assert.equal(recentDays("-1"), DEFAULT_RECENT_DAYS);
  assert.equal(recentDays(null), DEFAULT_RECENT_DAYS);
});

/* ------------------------------------------------------- coverage language */

test("a distribution over most of the data may speak for it", () => {
  const coverage = coverageOf(90, 100);
  assert.equal(coverage.tier, "normal");
  assert.equal(coverage.representative, true);
  assert.match(coverage.pair, /90 \/ 100/);
  assert.match(coverage.qualifier, /จากโฆษณา 100 รายการ/);
});

test("a distribution over half the data says so, in words", () => {
  const coverage = coverageOf(60, 100);
  assert.equal(coverage.tier, "partial");
  assert.equal(coverage.representative, false);
  // The exact failure this prevents: "42% ใช้ Send Message" stated over 60%
  // coverage, which reads as a fact about the page and is not one.
  assert.match(coverage.qualifier, /เฉพาะในโฆษณาที่อ่านค่าได้/);
  assert.match(coverage.qualifier, /ไม่ใช่ทั้งเพจ/);
});

test("low coverage is never described as representative", () => {
  const coverage = coverageOf(20, 100);
  assert.equal(coverage.tier, "low");
  assert.equal(coverage.representative, false);
  assert.match(coverage.qualifier, /ไม่ใช่ทั้งเพจ/);
});

test("nothing measured is unknown, not zero coverage", () => {
  const coverage = coverageOf(0, 0);
  assert.equal(coverage.tier, "unknown");
  assert.equal(coverage.representative, false);
  // A page with no ads in scope has not scored badly; nothing was measured.
  assert.doesNotMatch(coverage.qualifier, /ไม่ใช่ทั้งเพจ/);
});

test("the tier boundaries are the product's, not this module's", () => {
  assert.equal(coverageOf(80, 100).tier, "normal");
  assert.equal(coverageOf(79, 100).tier, "partial");
  assert.equal(coverageOf(50, 100).tier, "partial");
  assert.equal(coverageOf(49, 100).tier, "low");
});

test("a share is computed against the denominator it was given", () => {
  assert.equal(share(50, 100), 50);
  assert.equal(formatShare(1, 3), "33.3%");
  // A multi-value dimension divides by ads observed, so the shares may exceed
  // 100% in total — this is the arithmetic that makes a pie chart wrong.
  const platforms = [42, 40, 30, 12];
  const observed = 50;
  const totalShare = platforms.reduce((sum, n) => sum + share(n, observed), 0);
  assert.ok(totalShare > 100, "multi-value shares are expected to exceed 100%");
  // ...and no denominator means no percentage, rather than a division by zero.
  assert.equal(share(5, 0), 0);
});
