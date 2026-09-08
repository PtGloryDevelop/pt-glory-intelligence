import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_RANGE, GRAINS, METRIC_LABEL, METRIC_SOURCE, RANGES, TIMELINE_METRICS,
  bucketEnd, comparability, defaultGrain, rangeWindow, runStatus,
  timelineGrain, timelineMetric, timelineRange,
} from "../lib/pages/timeline.ts";

/**
 * The timeline's contract, tested away from the database.
 *
 * The rule worth protecting here is the one the whole feature rests on: three
 * clocks, named, never merged, and never silently substituted for one another.
 */

test("the three clocks are the only metrics, and each is named for what it is", () => {
  assert.deepEqual([...TIMELINE_METRICS], ["started", "first_seen", "run"]);

  // Meta's date and ours must not read as the same sentence.
  assert.notEqual(METRIC_LABEL.started, METRIC_LABEL.first_seen);
  assert.match(METRIC_LABEL.started, /เริ่มแสดง/);
  assert.match(METRIC_LABEL.first_seen, /PT Glory/);

  // ...and first_seen must say it is global, because it is: the ad may have been
  // seen in a run outside the scope being looked at.
  assert.match(METRIC_SOURCE.first_seen, /ทุกรอบเก็บ/);
  assert.match(METRIC_SOURCE.started, /Meta/);
  assert.match(METRIC_SOURCE.run, /รอบเก็บ/);
});

test("first-seen is never described as entering the market", () => {
  // The gap between an ad starting and us seeing it is our coverage, not the
  // advertiser's behaviour. These words would turn one into the other.
  const forbidden = /เข้าตลาด|เริ่มยิง|เร่งยิง|ลดการยิง|เพิ่มงบ|หยุดแคมเปญ/;
  for (const value of [...Object.values(METRIC_LABEL), ...Object.values(METRIC_SOURCE)]) {
    assert.ok(!forbidden.test(value), `causal wording in "${value}"`);
  }
});

test("metric, range, grain and status are allowlists", () => {
  assert.equal(timelineMetric("run"), "run");
  assert.equal(timelineMetric("spend"), null);
  assert.equal(timelineMetric(null), null);

  assert.equal(timelineRange("90d"), "90d");
  // An unknown range falls back to the widest, never to a narrow one: a preset
  // that quietly hid older data would make a long history look short.
  assert.equal(timelineRange("everything"), DEFAULT_RANGE);
  assert.equal(DEFAULT_RANGE, "all");

  assert.equal(runStatus("unknown"), "unknown");
  assert.equal(runStatus("paused"), null);
});

test("the default grain follows the span, not the screen", () => {
  assert.equal(defaultGrain("30d"), "day");
  assert.equal(defaultGrain("90d"), "day");
  assert.equal(defaultGrain("180d"), "week");
  assert.equal(defaultGrain("all"), "week");

  // Explicit beats derived, so a shared URL keeps the grain it was shared with.
  assert.equal(timelineGrain("week", "30d"), "week");
  assert.equal(timelineGrain("fortnight", "30d"), "day");
  for (const grain of GRAINS) assert.equal(timelineGrain(grain, "all"), grain);
});

test("a range is a window, and 'all' hides nothing", () => {
  const now = new Date("2026-09-08T00:00:00.000Z");
  const ninety = rangeWindow("90d", now);
  assert.equal(ninety.from, "2026-06-10T00:00:00.000Z");
  // The end is exclusive and one day ahead, so today's own bucket is included
  // rather than falling off the edge of its own chart.
  assert.equal(ninety.to, "2026-09-09T00:00:00.000Z");

  assert.deepEqual(rangeWindow("all", now), { from: null, to: null });
  for (const range of RANGES) {
    const window = rangeWindow(range, now);
    assert.equal(range === "all", window.from === null);
  }
});

test("a bucket ends where the next one begins", () => {
  assert.equal(bucketEnd("2026-09-07T00:00:00.000Z", "day"), "2026-09-08T00:00:00.000Z");
  assert.equal(bucketEnd("2026-09-07T00:00:00.000Z", "week"), "2026-09-14T00:00:00.000Z");
  // Half-open windows are what make a click reproduce the count exactly: an ad
  // on the boundary belongs to one bucket, never to both.
});

/* ------------------------------------------------------------ comparability */

test("runs collected the same way are comparable", () => {
  const runs = [
    { scope_query: "วิตามิน", scope_country: "TH" },
    { scope_query: "วิตามิน", scope_country: "TH" },
  ];
  const result = comparability(runs);
  assert.equal(result.comparable, true);
  assert.equal(result.note, null);
});

test("runs that asked different questions are flagged, not corrected", () => {
  const result = comparability([
    { scope_query: "วิตามิน", scope_country: "TH" },
    { scope_query: "คอลลาเจน", scope_country: "TH" },
  ]);
  assert.equal(result.comparable, false);
  assert.match(result.note!, /คำค้น/);
  // The caveat says the difference may be the collection, not the page. It does
  // not attempt to adjust either number.
  assert.match(result.note!, /ขอบเขตการเก็บ/);
  assert.match(result.note!, /ไม่ใช่การเปลี่ยนแปลงของเพจ/);
});

test("a different country is as disqualifying as a different query", () => {
  const result = comparability([
    { scope_query: "วิตามิน", scope_country: "TH" },
    { scope_query: "วิตามิน", scope_country: "SG" },
  ]);
  assert.equal(result.comparable, false);
  assert.match(result.note!, /ประเทศ/);
});

test("a missing scope value is its own value, not a match", () => {
  // One run with no recorded query and one with a query are not comparable just
  // because null is falsy.
  const result = comparability([
    { scope_query: null, scope_country: "TH" },
    { scope_query: "วิตามิน", scope_country: "TH" },
  ]);
  assert.equal(result.comparable, false);
  assert.equal(comparability([{ scope_query: null, scope_country: null }]).comparable, true);
});
