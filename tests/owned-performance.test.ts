import test from "node:test";
import assert from "node:assert/strict";
import { parseOwnedPerformanceQuery, ownedPerformancePeriod, previousOwnedPerformancePeriod, OwnedPerformanceQueryError, closeRate, daysSinceCreated } from "../lib/owned-ads/performance.ts";

test("performance filters validate boundaries and calendar periods preserve real Bangkok dates", () => {
  const query = (input = "") => parseOwnedPerformanceQuery(new URLSearchParams(input));
  const midnight = new Date("2026-09-30T18:00:00Z"); // Oct 1 in Bangkok.
  const coverage = { from: "2026-09-02", to: "2026-09-30" };
  // Rolling presets end on the last finished day with data (never today, never past coverage).
  assert.deepEqual(ownedPerformancePeriod(query(), coverage, midnight), { from: "2026-09-24", to: "2026-09-30" });
  assert.deepEqual(ownedPerformancePeriod(query("period=3d"), null, midnight), { from: "2026-09-28", to: "2026-09-30" });
  const fiveOct = new Date("2026-10-05T03:00:00Z"), stale = { from: "2026-09-02", to: "2026-10-02" };
  assert.deepEqual(ownedPerformancePeriod(query("period=7d"), stale, fiveOct), { from: "2026-09-26", to: "2026-10-02" });
  assert.deepEqual(ownedPerformancePeriod(query("period=this-month"), coverage, midnight), { from: "2026-10-01", to: "2026-10-01" });
  assert.deepEqual(ownedPerformancePeriod(query("period=last-month"), coverage, midnight), { from: "2026-09-01", to: "2026-09-30" });
  assert.deepEqual(ownedPerformancePeriod(query("period=today"), coverage, midnight), { from: "2026-10-01", to: "2026-10-01" });
  assert.deepEqual(ownedPerformancePeriod(query("period=yesterday"), coverage, midnight), { from: "2026-09-30", to: "2026-09-30" });
  assert.deepEqual(ownedPerformancePeriod(query("period=all"), coverage, midnight), coverage);
  const leap = ownedPerformancePeriod(query("period=custom&from=2024-02-29&to=2024-03-01"), null, midnight);
  assert.deepEqual(previousOwnedPerformancePeriod(leap), { from: "2024-02-27", to: "2024-02-28" });
  assert.equal(query("unit=AAAAAAAA-AAAA-AAAA-AAAA-AAAAAAAAAAAA&pageId=123&page=2&sort=roas&compare=1&q=%20test%20").unit, "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa");
  assert.equal(query("q=%20test%20").q, "test");
  assert.equal(query("status=WITH_ISSUES").status, "WITH_ISSUES");
  for (const input of ["period=unknown", "status=fake", "status=ACTIVE&status=PAUSED", "sort=viral", "page=-1", "page=1.5", "page=1e2", "page=100001", "page=", "page=1&page=2", "q=" + "a".repeat(161), "unit=12", "pageId=javascript:alert(1)", "compare=yes", "period=custom", "period=custom&from=2026-02-30&to=2026-03-01", "period=custom&from=2026-03-02&to=2026-03-01", "from=0000-01-01", "from=2026-13-01"]) {
    assert.throws(() => query(input), OwnedPerformanceQueryError, input);
  }
  assert.throws(() => previousOwnedPerformancePeriod({ from: "0001-01-01", to: "0001-01-01" }), OwnedPerformanceQueryError);
});

test("sort direction defaults per metric and only a flipped direction reaches the RPC suffixed", async () => {
  const { ownedSortArg } = await import("../lib/owned-ads/performance.ts");
  const parse = (input: string) => parseOwnedPerformanceQuery(new URLSearchParams(input));
  assert.equal(parse("").dir, "desc");
  assert.equal(parse("sort=cost_per_conversation").dir, "asc");
  assert.equal(ownedSortArg(parse("sort=spend")), "spend");
  assert.equal(ownedSortArg(parse("sort=spend&dir=asc")), "spend:asc");
  assert.equal(ownedSortArg(parse("sort=cost_per_conversation&dir=desc")), "cost_per_conversation:desc");
  for (const bad of ["dir=up", "dir=asc&dir=desc"]) assert.throws(() => parse(bad), OwnedPerformanceQueryError);
});

test("close rate is Meta-reported orders over chats and hides thin samples", () => {
  assert.equal(closeRate({ purchases: 13, conversations: 40 }, 30), 13 / 40);
  assert.equal(closeRate({ purchases: 2, conversations: 2 }, 30), null, "two chats and two orders must not read as 100%");
  assert.equal(closeRate({ purchases: null, conversations: 100 }, 30), null);
  assert.equal(closeRate({ purchases: 5, conversations: null }, 30), null);
  assert.equal(closeRate({ purchases: 0, conversations: 30 }, 30), 0);
});

test("days since creation count Bangkok calendar days", () => {
  const now = new Date("2026-10-07T03:00:00Z"); // 10:00 on 7 Oct in Bangkok
  assert.equal(daysSinceCreated("2026-10-06T18:30:00+00:00", now), 0); // 01:30 on 7 Oct in Bangkok
  assert.equal(daysSinceCreated("2026-10-06T16:00:00+00:00", now), 1); // 23:00 on 6 Oct in Bangkok
  assert.equal(daysSinceCreated("2024-11-18T09:41:15+00:00", now), 688);
  assert.equal(daysSinceCreated(null, now), null);
  assert.equal(daysSinceCreated("not a date", now), null);
});

test("close rate is a sort that opens highest first", async () => {
  const { ownedSortArg } = await import("../lib/owned-ads/performance.ts");
  const parsed = parseOwnedPerformanceQuery(new URLSearchParams("sort=close_rate"));
  assert.equal(parsed.dir, "desc");
  assert.equal(ownedSortArg(parsed), "close_rate");
  assert.equal(ownedSortArg(parseOwnedPerformanceQuery(new URLSearchParams("sort=close_rate&dir=asc"))), "close_rate:asc");
});

test("creative grouping is opt-in on the API and its keys are Meta ids or one ad", async () => {
  const { parseOwnedPerformanceQuery, OWNED_MEDIA_KEY } = await import("../lib/owned-ads/performance.ts");
  assert.equal(parseOwnedPerformanceQuery(new URLSearchParams()).media, false, "per ad unless asked: the compare page reads ads");
  assert.equal(parseOwnedPerformanceQuery(new URLSearchParams("media=1")).media, true);
  assert.throws(() => parseOwnedPerformanceQuery(new URLSearchParams("media=yes")));
  assert.throws(() => parseOwnedPerformanceQuery(new URLSearchParams("media=1&media=0")));
  for (const key of ["v:3221200154747773", "c:1023234730733727", "a:act_747201513533457:120250517546710673"]) assert.ok(OWNED_MEDIA_KEY.test(key), key);
  for (const key of ["v:", "x:1", "v:1;drop", "a:act_1", "a:act_1:2:3"]) assert.ok(!OWNED_MEDIA_KEY.test(key), key);
});
