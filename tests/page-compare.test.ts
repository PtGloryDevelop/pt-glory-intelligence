import assert from "node:assert/strict";
import test from "node:test";
import {
  COMPARE_METRICS, COMPARE_ROWS, REFUSAL_MESSAGE, compareClock, compareMetric,
  delta, isComparablePageId, validateCompare,
} from "../lib/compare/contract.ts";
import { PAGE_SIGNALS } from "../lib/pages/scope.ts";

/**
 * The compare contract, tested away from the database.
 *
 * Almost every case here is about what Compare may not say. The arithmetic is
 * trivial; the risk is that a subtraction gets read as a verdict, and the
 * wording is the only thing standing between the two.
 */

test("a delta is a subtraction, and says so", () => {
  const more = delta(42, 31);
  assert.equal(more.value, 11);
  assert.equal(more.leader, "a");
  assert.equal(more.label, "A มากกว่า 11 รายการ");

  const fewer = delta(8, 11);
  assert.equal(fewer.leader, "b");
  assert.equal(fewer.label, "B มากกว่า 3 รายการ");

  const same = delta(5, 5);
  assert.equal(same.leader, null);
  assert.equal(same.label, "เท่ากัน");
});

test("no delta wording implies a winner or a cause", () => {
  const forbidden = /ชนะ|แพ้|เหนือกว่า|ดีกว่า|แรงกว่า|ครองตลาด|win|beat|dominat|outperform/i;
  for (const [a, b] of [[10, 3], [3, 10], [4, 4]] as const) {
    assert.ok(!forbidden.test(delta(a, b).label), `"${delta(a, b).label}" reads as a verdict`);
  }
  for (const row of COMPARE_ROWS) {
    assert.ok(!forbidden.test(row.label), `row label "${row.label}"`);
    assert.ok(!forbidden.test(row.helper), `row helper "${row.helper}"`);
  }
});

test("no compare row names a metric this product does not have", () => {
  const forbidden = /spend|reach|impression|engagement|ctr|cpc|cpa|roas|conversion|winning|top|best|market share/i;
  for (const row of COMPARE_ROWS) {
    assert.ok(!forbidden.test(row.label));
    assert.ok(!forbidden.test(row.helper));
    assert.ok(!forbidden.test(row.metric));
  }
});

test("every drillable row reuses a frozen P2.1 signal, never a new one", () => {
  for (const row of COMPARE_ROWS) {
    if (row.signal === null) continue;
    assert.ok(
      (PAGE_SIGNALS as readonly string[]).includes(row.signal),
      `${row.metric} drills into "${row.signal}", which is not a frozen signal`,
    );
  }
});

test("recently found and started recently stay two rows with two sentences", () => {
  const recent = COMPARE_ROWS.find((row) => row.metric === "recent")!;
  const started = COMPARE_ROWS.find((row) => row.metric === "started_recently")!;
  assert.notEqual(recent.label, started.label);
  assert.match(recent.helper, /เราเห็นครั้งแรก/);
  assert.match(started.helper, /Meta/);
  // ...and they drill into different signals, so the evidence differs too.
  assert.notEqual(recent.signal, started.signal);
});

test("active, inactive and unknown are three separate rows", () => {
  for (const metric of ["active", "inactive", "unknown"] as const) {
    assert.ok(COMPARE_ROWS.some((row) => row.metric === metric));
  }
  const unknown = COMPARE_ROWS.find((row) => row.metric === "unknown")!;
  assert.match(unknown.helper, /ไม่ใช่หยุดแสดง/);
});

test("metric and clock are allowlists", () => {
  assert.equal(compareMetric("evergreen"), "evergreen");
  assert.equal(compareMetric("spend"), null);
  assert.equal(compareMetric(null), null);
  assert.deepEqual([...COMPARE_METRICS].sort(), [
    "active", "evergreen", "inactive", "observed", "recent", "reused",
    "started_recently", "unknown",
  ]);

  assert.equal(compareClock("first_seen"), "first_seen");
  // An unrecognised clock falls back to one named clock rather than mixing.
  assert.equal(compareClock("whenever"), "started");
});

/* ------------------------------------------------------------- validation */

const VALID = { pageA: "111", pageB: "222", aInScope: true, bInScope: true };

test("a valid comparison is two different pages, both in the scope", () => {
  assert.equal(validateCompare(VALID), null);
});

test("comparing a page with itself is refused", () => {
  const refusal = validateCompare({ ...VALID, pageB: "111" });
  assert.deepEqual(refusal, { kind: "same-page" });
  assert.match(REFUSAL_MESSAGE["same-page"], /คนละเพจ/);
});

test("an incomplete selection asks rather than guesses", () => {
  assert.deepEqual(validateCompare({ ...VALID, pageB: null }), { kind: "incomplete" });
  assert.deepEqual(validateCompare({ ...VALID, pageA: null }), { kind: "incomplete" });
});

test("a page outside the scope is refused, never rendered as zero", () => {
  assert.deepEqual(validateCompare({ ...VALID, bInScope: false }), { kind: "missing", side: "b" });
  assert.deepEqual(validateCompare({ ...VALID, aInScope: false }), { kind: "missing", side: "a" });
  // The message has to make the difference explicit: a page we have never seen
  // in this scope is not a page that ran no ads.
  assert.match(REFUSAL_MESSAGE.missing, /ไม่ใช่ว่าพบ 0/);
});

test("page ids are validated before they reach SQL", () => {
  assert.equal(isComparablePageId("710000000000001"), true);
  assert.equal(isComparablePageId("not-a-page"), false);
  assert.equal(isComparablePageId(""), false);
  assert.equal(isComparablePageId(null), false);
  assert.equal(isComparablePageId(undefined), false);
});
