import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { authenticateCollectionAdvance } from "../lib/collect/machine-auth.ts";
import { processOneWork, selectOneDueWork } from "../lib/collect/advance-scheduler.ts";

const SECRET = "0123456789abcdef0123456789abcdef";
const ROUTE = readFileSync(join("app", "api", "collections", "advance", "route.ts"), "utf8");

test("collection advance authentication fails closed when unset or weak", () => {
  const previous = process.env.COLLECTION_ADVANCE_TOKEN;
  try {
    delete process.env.COLLECTION_ADVANCE_TOKEN;
    assert.equal(authenticateCollectionAdvance(`Bearer ${SECRET}`), "not_configured");
    process.env.COLLECTION_ADVANCE_TOKEN = "short";
    assert.equal(authenticateCollectionAdvance(`Bearer short`), "not_configured");
  } finally {
    if (previous === undefined) delete process.env.COLLECTION_ADVANCE_TOKEN;
    else process.env.COLLECTION_ADVANCE_TOKEN = previous;
  }
});

test("only the exact collection advance bearer token authenticates", () => {
  const previous = process.env.COLLECTION_ADVANCE_TOKEN;
  process.env.COLLECTION_ADVANCE_TOKEN = SECRET;
  try {
    assert.equal(authenticateCollectionAdvance(`Bearer ${SECRET}`), "ok");
    assert.equal(authenticateCollectionAdvance(`Bearer  ${SECRET} `), "ok");
    for (const header of [null, "", "Bearer", "Bearer ", SECRET, `Basic ${SECRET}`,
      `bearer ${SECRET}`, `Bearer ${SECRET}x`, `Bearer ${SECRET.slice(0, -1)}`]) {
      assert.equal(authenticateCollectionAdvance(header), "unauthorized", JSON.stringify(header));
    }
  } finally {
    if (previous === undefined) delete process.env.COLLECTION_ADVANCE_TOKEN;
    else process.env.COLLECTION_ADVANCE_TOKEN = previous;
  }
});

test("the advance route acknowledges work and defers each bounded step", () => {
  assert.match(ROUTE, /authenticateCollectionAdvance\(/);
  assert.match(ROUTE, /status: 401/);
  assert.match(ROUTE, /export const maxDuration = 300/);
  assert.match(ROUTE, /after\(\(\) => processWork/);
  assert.match(ROUTE, /status: 202/);
  assert.match(ROUTE, /limit 1/);
  assert.match(ROUTE, /processOneWork\(/);
  assert.match(ROUTE, /advance: \(id\) => advance\(id/);
  assert.match(ROUTE, /reconcileCost: \(id\) => reconcileCost\(id/);
  assert.doesNotMatch(ROUTE, /for\s*\(/, "one HTTP tick must not loop over due rows");
});

test("one scheduled tick processes only one of three due work items", async () => {
  const due = [
    { id: "first", kind: "advance" as const },
    { id: "second", kind: "advance" as const },
    { id: "third", kind: "cost" as const },
  ];
  const selected = selectOneDueWork(due);
  const processed: string[] = [];
  let afterRuns = 0;

  const response = { status: 202, accepted: selected === null ? 0 : 1 };
  const after = async () => {
    afterRuns += 1;
    await processOneWork(selected, {
      advance: async (id) => { processed.push(`advance:${id}`); },
      reconcileCost: async (id) => { processed.push(`cost:${id}`); },
    });
  };

  assert.equal(response.status, 202);
  assert.equal(response.accepted, 1);
  await after();
  assert.equal(afterRuns, 1);
  assert.deepEqual(processed, ["advance:first"]);
  assert.deepEqual(due.slice(1).map((item) => item.id), ["second", "third"]);
});
