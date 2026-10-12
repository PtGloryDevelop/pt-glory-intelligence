import test from "node:test";
import assert from "node:assert/strict";
import { nextRun, parseTimes } from "../scripts/owned-sync-schedule.mjs";

const times = ["09:00", "13:00", "18:00"];
// Bangkok is UTC+7: 09:00 Bangkok is 02:00Z.
const at = (iso: string) => nextRun(times, new Date(iso)).toISOString();

test("the owned sync runs at the next listed Bangkok time", () => {
  assert.equal(at("2026-10-12T01:59:00Z"), "2026-10-12T02:00:00.000Z", "08:59 Bangkok → 09:00 today");
  assert.equal(at("2026-10-12T02:00:00Z"), "2026-10-12T06:00:00.000Z", "exactly 09:00 → 13:00, never the same run twice");
  assert.equal(at("2026-10-12T11:30:00Z"), "2026-10-13T02:00:00.000Z", "18:30 Bangkok → 09:00 tomorrow");
  assert.equal(at("2026-10-12T17:30:00Z"), "2026-10-13T02:00:00.000Z", "00:30 Bangkok (still 12 Oct in UTC) → 09:00 that Bangkok day");
  assert.equal(nextRun(["00:15"], new Date("2026-12-31T17:20:00Z")).toISOString(), "2027-01-01T17:15:00.000Z", "past today's slot → tomorrow, across a year");
});

test("schedule times must be HH:MM", () => {
  assert.deepEqual(parseTimes("09:00, 13:00,18:00"), times);
  for (const bad of ["", "9:00", "24:00", "09:60", "09:00,noon"]) assert.equal(parseTimes(bad), null, bad);
});
