import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createMockProvider, mockRun } from "../lib/collect/mock.ts";
import { findOriginalStart } from "../lib/collect/reconcile.ts";

const request = {
  id: "request-1",
  sourceUrl: "https://www.facebook.com/ads/library/?q=test",
  startAttemptedAt: "2026-09-11T09:09:12.548Z",
};

test("original-start lookup is exact, bounded and read-only", async () => {
  const run = mockRun({ runId: "RUN-1", keyValueStoreId: "KV-1" });
  const one = createMockProvider({
    runsSince: [run], runInput: { runTag: request.id, sourceUrl: request.sourceUrl },
  }, { PT_GLORY_ENV: "test" });
  const matched = await findOriginalStart(one, request, 20);
  assert.equal(matched.kind, "match");
  assert.equal(one.startCount, 0);
  assert.deepEqual(one.calls.map((call) => call.operation), ["findRunsSince", "readRunInput"]);

  const none = createMockProvider({
    runsSince: [run], runInput: { runTag: "other", sourceUrl: request.sourceUrl },
  }, { PT_GLORY_ENV: "test" });
  assert.equal((await findOriginalStart(none, request, 20)).kind, "none");

  const ambiguous = createMockProvider({
    runsSince: [run, mockRun({ runId: "RUN-2", keyValueStoreId: "KV-2" })],
    runInput: { runTag: request.id, sourceUrl: request.sourceUrl },
  }, { PT_GLORY_ENV: "test" });
  const many = await findOriginalStart(ambiguous, request, 20);
  assert.equal(many.kind, "ambiguous");
  assert.equal(many.kind === "ambiguous" ? many.count : null, 2);
  assert.equal(ambiguous.startCount, 0);
});

test("admin recovery has no provider start or fetch path", () => {
  const source = readFileSync("lib/collect/recovery.ts", "utf8");
  assert.doesNotMatch(source, /\.startRun|startRun\(|fetch\(/i);
  assert.match(source, /findOriginalStart/);
});
