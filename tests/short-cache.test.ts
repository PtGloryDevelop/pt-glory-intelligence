import assert from "node:assert/strict";
import test from "node:test";
import { shortCache } from "../lib/read/short-cache.ts";
import { latestRound } from "../lib/read/latest-round.ts";

test("an answer is reused until it expires, then read again", async () => {
  let clock = 0, reads = 0;
  const cached = shortCache<number>(100, 10, () => clock);
  const read = async () => ++reads;
  assert.equal(await cached("a", read), 1);
  clock = 99;
  assert.equal(await cached("a", read), 1);
  clock = 100;
  assert.equal(await cached("a", read), 2);
});

test("different keys never share an answer", async () => {
  const cached = shortCache<string>(100, 10, () => 0);
  assert.equal(await cached("a", async () => "first"), "first");
  assert.equal(await cached("b", async () => "second"), "second");
});

test("views asking at the same moment share one read", async () => {
  let reads = 0;
  const cached = shortCache<number>(100, 10, () => 0);
  const read = async () => ++reads;
  assert.deepEqual(await Promise.all([cached("a", read), cached("a", read)]), [1, 1]);
  assert.equal(reads, 1);
});

test("a failed read is not kept", async () => {
  const cached = shortCache<string>(100, 10, () => 0);
  await assert.rejects(cached("a", async () => { throw new Error("timeout"); }));
  assert.equal(await cached("a", async () => "ok"), "ok");
});

test("the cache stays within its size", async () => {
  let reads = 0;
  const cached = shortCache<number>(100, 2, () => 0);
  const read = async () => ++reads;
  await cached("a", read); await cached("b", read); await cached("c", read);
  assert.equal(await cached("a", read), 4);
});

const round = (collected_at: string) => ({ run: { collected_at } });

test("the latest round is the newest moment, whatever the text form", () => {
  const rows = [round("2026-11-01T10:00:00+00:00"), round("2026-11-03T00:00:00+07:00"), round("2026-11-02T17:30:00+00:00")];
  assert.equal(latestRound(rows).lastCollectedAt, "2026-11-02T17:30:00+00:00");
});

test("no rounds means no time, never a made-up one", () => {
  assert.deepEqual(latestRound([]), { lastCollectedAt: null, stamp: "0:" });
});

test("the stamp moves when a round is added or removed", () => {
  const two = [round("2026-11-01T10:00:00Z"), round("2026-11-02T10:00:00Z")];
  const removed = [two[1]];
  const added = [...two, round("2026-11-03T10:00:00Z")];
  assert.notEqual(latestRound(two).stamp, latestRound(removed).stamp);
  assert.notEqual(latestRound(two).stamp, latestRound(added).stamp);
});
