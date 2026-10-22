import assert from "node:assert/strict";
import test from "node:test";
import { daysBehind, ownedLate, rivalsLate } from "../lib/shell/stale.ts";

/**
 * One rule for "late", read by the sidebar's amber box and the overview's band.
 * Owned figures arrive daily, so two missed days is late; rivals are collected
 * by hand, so a week without a round is late.
 */

// 21 Oct 2026, 13:00 in Bangkok.
const NOW = Date.parse("2026-10-21T06:00:00.000Z");

test("owned figures are late once the last day with figures ended more than two days ago", () => {
  assert.equal(ownedLate("2026-10-20", NOW), false);
  assert.equal(ownedLate("2026-10-19", NOW), false);
  assert.equal(ownedLate("2026-10-18", NOW), true);
  assert.equal(ownedLate("2026-10-12", NOW), true);
});

test("rivals are late a week after the newest collection", () => {
  assert.equal(rivalsLate("2026-10-15T06:00:00.000Z", NOW), false);
  assert.equal(rivalsLate("2026-10-14T05:00:00.000Z", NOW), true);
  assert.equal(rivalsLate("2026-10-06T03:12:00.000Z", NOW), true);
});

test("days behind are counted in Bangkok calendar days", () => {
  assert.equal(daysBehind("2026-10-12", NOW), 9);
  assert.equal(daysBehind("2026-10-21", NOW), 0);
  // 6 Oct 20:00 UTC is already 7 Oct in Bangkok.
  assert.equal(daysBehind("2026-10-06T20:00:00.000Z", NOW), 14);
  assert.equal(daysBehind("2026-10-06T03:12:00.000Z", NOW), 15);
  // A clock that ran ahead is not negative age.
  assert.equal(daysBehind("2026-10-25", NOW), 0);
});
