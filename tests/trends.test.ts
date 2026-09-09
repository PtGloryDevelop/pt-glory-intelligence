import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_PERIOD, DIRECTION_MARK, LOW_BASE, changeOf, comparabilityOf,
  periodLength, pointChange, share, trendPeriods,
} from "../lib/trends/periods.ts";
import {
  EVENT_METRICS, RANK_LABEL, STATE_METRICS, TREND_ROWS, metricRow, rankDirection, trendMetric,
} from "../lib/trends/metrics.ts";

/**
 * The trend contract, tested away from the database.
 *
 * Two things carry the most risk here and both are arithmetic: a window that is
 * not the same length as the one it is compared with, and a percentage computed
 * from a base too small to mean anything. Everything else is wording.
 */

const DAY = 86_400_000;
const REFERENCE = new Date("2026-09-09T07:30:00.000Z");

test("the two windows are equal, adjacent and half-open", () => {
  const periods = trendPeriods(30, REFERENCE);
  assert.equal(periods.current.to, REFERENCE.toISOString());
  // Previous ends exactly where current begins: no gap, no overlap, so an ad on
  // the boundary belongs to one window and never to both.
  assert.equal(periods.previous.to, periods.current.from);

  const length = (window: { from: string; to: string }) =>
    new Date(window.to).getTime() - new Date(window.from).getTime();
  assert.equal(length(periods.current), 30 * DAY);
  assert.equal(length(periods.previous), 30 * DAY);
  assert.equal(length(periods.current), length(periods.previous));
});

test("every offered length produces two equal windows", () => {
  for (const days of [7, 14, 30] as const) {
    const periods = trendPeriods(days, REFERENCE);
    assert.equal(
      new Date(periods.current.to).getTime() - new Date(periods.current.from).getTime(),
      new Date(periods.previous.to).getTime() - new Date(periods.previous.from).getTime(),
      `${days}d windows must match in length`,
    );
  }
});

test("windows are absolute instants, so boundaries do not drift", () => {
  // Month boundary.
  const month = trendPeriods(7, new Date("2026-03-03T00:00:00.000Z"));
  assert.equal(month.current.from, "2026-02-24T00:00:00.000Z");
  assert.equal(month.previous.from, "2026-02-17T00:00:00.000Z");

  // Year boundary.
  const year = trendPeriods(30, new Date("2026-01-15T12:00:00.000Z"));
  assert.equal(year.current.from, "2025-12-16T12:00:00.000Z");
  assert.equal(year.previous.from, "2025-11-16T12:00:00.000Z");

  // Midnight, and a reference mid-day: the window is measured from the instant
  // given, not snapped to a local calendar day that would move with a timezone.
  const midnight = trendPeriods(7, new Date("2026-09-09T00:00:00.000Z"));
  assert.equal(midnight.current.from, "2026-09-02T00:00:00.000Z");
  const midday = trendPeriods(7, new Date("2026-09-09T13:45:11.000Z"));
  assert.equal(midday.current.from, "2026-09-02T13:45:11.000Z");
});

test("an unrecognised period length falls back rather than mixing", () => {
  assert.equal(periodLength("7"), 7);
  assert.equal(periodLength("90"), DEFAULT_PERIOD);
  assert.equal(periodLength(null), DEFAULT_PERIOD);
});

/* ------------------------------------------------------------- arithmetic */

test("a change is a subtraction with a direction", () => {
  const up = changeOf(18, 11);
  assert.equal(up.delta, 7);
  assert.equal(up.direction, "up");
  assert.match(up.label, /มากกว่าช่วงก่อน 7 รายการ/);
  assert.match(up.label, /ในข้อมูลที่เราพบ/);

  const down = changeOf(4, 9);
  assert.equal(down.direction, "down");
  assert.match(down.label, /น้อยกว่าช่วงก่อน 5 รายการ/);

  const flat = changeOf(6, 6);
  assert.equal(flat.direction, "flat");
  assert.equal(flat.label, "ไม่เปลี่ยนจากช่วงก่อน");
});

test("a base of zero produces no percentage at all", () => {
  const change = changeOf(5, 0);
  // Not +∞%, not +500%, and not silently hidden: the raw sentence is the
  // honest one.
  assert.equal(change.percent, null);
  assert.equal(change.label, "จาก 0 เป็น 5 ในข้อมูลที่เราพบ");
  assert.equal(change.lowBase, true);
});

test("a small base is flagged rather than dressed up as a big percentage", () => {
  const tiny = changeOf(5, 2);
  assert.equal(tiny.percent, 150);
  // +150% from a base of two is noise; the flag is what stops the UI printing
  // it as though it were a finding.
  assert.equal(tiny.lowBase, true);

  const solid = changeOf(30, 20);
  assert.equal(solid.percent, 50);
  assert.equal(solid.lowBase, false);
  assert.equal(LOW_BASE, 5);
});

test("direction is available as a mark, never as colour alone", () => {
  assert.equal(DIRECTION_MARK.up, "▲");
  assert.equal(DIRECTION_MARK.down, "▼");
  assert.equal(DIRECTION_MARK.flat, "—");
});

test("a share change is stated in percentage points", () => {
  const change = pointChange(55, 40);
  assert.equal(change.points, 15);
  // 40% → 55% is +15 pp, not +37.5%. Both are true; only one is meant.
  assert.equal(change.label, "+15.0 pp");
  assert.equal(pointChange(30, 45).label, "−15.0 pp");
  assert.equal(pointChange(20, 20).label, "ไม่เปลี่ยน");
});

test("a share needs a denominator, and zero is not a division", () => {
  assert.equal(share(1, 4), 25);
  assert.equal(share(5, 0), 0);
});

/* ----------------------------------------------------------- metric kinds */

test("every metric is classified as an event or a state", () => {
  for (const row of TREND_ROWS) {
    assert.ok(row.kind === "event" || row.kind === "state", `${row.metric} has no kind`);
  }
  // The two clocks are the only events; everything else is only true as of an
  // instant, which is what forces the reference-point reconstruction.
  assert.deepEqual([...EVENT_METRICS], ["first_seen", "started"]);
  assert.deepEqual(
    [...STATE_METRICS].sort(),
    ["active", "evergreen", "inactive", "observed", "reused", "unknown"],
  );
});

test("state rows say they are as of the period end, not during it", () => {
  for (const metric of STATE_METRICS) {
    const row = metricRow(metric);
    assert.match(row.label, /ปลายช่วง/, `${metric} must say when it is true`);
  }
  // ...and the event rows say they are events in the window.
  for (const metric of EVENT_METRICS) {
    assert.match(metricRow(metric).helper, /ช่วงนี้|ในช่วง/);
  }
});

test("the two clocks keep separate labels", () => {
  assert.notEqual(metricRow("first_seen").label, metricRow("started").label);
  assert.match(metricRow("first_seen").label, /PT Glory/);
  assert.match(metricRow("started").label, /Meta/);
});

test("no trend label predicts, explains or names an unsupported metric", () => {
  const forbidden =
    /spend|reach|impression|engagement|ctr|cpc|cpa|roas|conversion|market share|momentum|forecast|คาดการณ์|พยากรณ์|เพิ่มงบ|เร่งยิง|ครองตลาด|โต|ตลาดขยาย/i;
  for (const row of TREND_ROWS) {
    assert.ok(!forbidden.test(row.label), `label "${row.label}"`);
    assert.ok(!forbidden.test(row.helper), `helper "${row.helper}"`);
  }
  for (const label of Object.values(RANK_LABEL)) {
    assert.ok(!forbidden.test(label), `rank label "${label}"`);
    // Ranking is by arithmetic delta and says so.
    assert.match(label, /ตามจำนวนที่เราพบ/);
  }
  for (const [a, b] of [[10, 3], [3, 10], [5, 0], [4, 4]] as const) {
    assert.ok(!forbidden.test(changeOf(a, b).label), changeOf(a, b).label);
  }
});

test("metric and direction are allowlists", () => {
  assert.equal(trendMetric("evergreen"), "evergreen");
  assert.equal(trendMetric("spend"), null);
  assert.equal(rankDirection("decrease"), "decrease");
  assert.equal(rankDirection("fastest"), "increase");
});

/* ---------------------------------------------------------- comparability */

const CONTEXT = { scope_query: "วิตามิน", scope_country: "TH" };

test("two periods collected the same way are comparable", () => {
  const result = comparabilityOf([CONTEXT], [CONTEXT]);
  assert.equal(result.verdict, "comparable");
  assert.equal(result.note, null);
});

test("different collection contexts are flagged, not corrected", () => {
  const result = comparabilityOf([CONTEXT], [{ ...CONTEXT, scope_query: "คอลลาเจน" }]);
  assert.equal(result.verdict, "mixed");
  assert.match(result.note!, /คำค้น/);
  assert.match(result.note!, /อาจสะท้อนวิธีเก็บ/);
  assert.match(result.note!, /ไม่ใช่พฤติกรรมของเพจหรือของตลาด/);
});

test("a period with no collection is insufficient, never zero activity", () => {
  const noCurrent = comparabilityOf([], [CONTEXT]);
  assert.equal(noCurrent.verdict, "insufficient");
  // The single most misleading thing this screen could do is render "we did not
  // look" as "there was nothing".
  assert.match(noCurrent.note!, /ไม่ได้แปลว่าไม่มีโฆษณา/);

  const noPrevious = comparabilityOf([CONTEXT], []);
  assert.equal(noPrevious.verdict, "insufficient");
  assert.match(noPrevious.note!, /ยังไม่ได้เก็บ/);
});
