import assert from "node:assert/strict";
import { test } from "node:test";
import { videoReadingWarnings, type VideoReadingHealth } from "../lib/media/health.ts";

// What the operator is told about the video reading queue (spec 2026-11-23 §17).
const healthy: VideoReadingHealth = {
  pending: 0, ready: 402, noVideo: 0, expired: 0, tooLarge: 2, failed: 0,
  waitingOver30m: 0, earliestExpiry: null, expiringWithin24h: 0,
  lastAttemptAt: "2026-11-23T08:25:08.126Z", stoppedLast24h: 404, expiredLast24h: 0,
};

test("a drained queue with nothing lost has no warning", () => {
  assert.deepEqual(videoReadingWarnings(healthy), []);
});

test("pending rows nobody picked up for 30 minutes point at the VPS worker", () => {
  const [warning] = videoReadingWarnings({ ...healthy, pending: 12, waitingOver30m: 12 });
  assert.match(warning, /^12 clip\(s\) pending for over 30 min/);
  assert.match(warning, /deploy\/video-reader/);
});

test("links about to die are named with the nearest expiry", () => {
  const warnings = videoReadingWarnings({ ...healthy, pending: 3, expiringWithin24h: 3, earliestExpiry: "2026-11-24T01:00:00.000Z" });
  assert.deepEqual(warnings, ["3 pending clip(s) expire within 24h · earliest 2026-11-24T01:00:00.000Z"]);
});

test("expired over 5% of the day's finished rows means the worker is behind; exactly 5% does not", () => {
  assert.deepEqual(videoReadingWarnings({ ...healthy, stoppedLast24h: 100, expiredLast24h: 5 }), []);
  const [warning] = videoReadingWarnings({ ...healthy, stoppedLast24h: 100, expiredLast24h: 6 });
  assert.equal(warning, "6 of 100 clips finished in 24h had expired (6.0% > 5%): add passes or raise VIDEO_READER_BATCH");
});

test("a quiet day (nothing finished) is not read as 0% or as an alert", () => {
  assert.deepEqual(videoReadingWarnings({ ...healthy, stoppedLast24h: 0, expiredLast24h: 0 }), []);
});

test("warnings come worst first: a stopped worker before deadlines before the daily share", () => {
  const warnings = videoReadingWarnings({
    ...healthy, pending: 5, waitingOver30m: 5, expiringWithin24h: 2, earliestExpiry: "2026-11-24T01:00:00.000Z",
    stoppedLast24h: 10, expiredLast24h: 4,
  });
  assert.equal(warnings.length, 3);
  assert.match(warnings[0], /pending for over 30 min/);
  assert.match(warnings[1], /expire within 24h/);
  assert.match(warnings[2], /had expired/);
});
