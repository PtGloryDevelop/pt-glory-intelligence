import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import * as budget from "../lib/collect/budget.ts";
import * as roles from "../lib/auth/role-model.ts";
import { authenticateCollectionAdvance } from "../lib/collect/machine-auth.ts";
import { processOneWork, selectOneDueWork } from "../lib/collect/advance-scheduler.ts";

const SECRET = "0123456789abcdef0123456789abcdef";
const ROUTE = readFileSync(join("app", "api", "collections", "advance", "route.ts"), "utf8");
const PROGRESS = readFileSync(join("app", "(app)", "collect", "[id]", "progress-client.tsx"), "utf8");

// Scheduler ordering is exercised against PostgreSQL using the actual route in tests/db/collection-queue.test.ts.

test("waiting and collecting guidance explains automatic continuation after closing the page", () => {
  const queued = /queued: "([^"]+)"/.exec(PROGRESS)?.[1] ?? "";
  const collecting = /collecting: "([^"]+)"/.exec(PROGRESS)?.[1] ?? "";
  assert.match(queued, /รอบเก็บข้อมูลว่าง/);
  assert.match(queued, /งบประมาณ/);
  for (const guidance of [queued, collecting]) assert.match(guidance, /ปิดเว็บ.*ทำต่อเอง/);
  assert.doesNotMatch(collecting, /ตราบที่ยังเปิดเว็บ/);
});

test("progress allows a fresh request while the existing one waits or collects", () => {
  assert.match(PROGRESS, /\(settled \|\| collection\.status === "queued" \|\| collection\.status === "collecting"\)/);
  assert.match(PROGRESS, /onClick=\{onRestart\} data-testid="collect-again"/);
  assert.match(PROGRESS, /href="\/collect" data-testid="collect-again"/);
});

test("usage counts positive monetary holds without counting unreserved queued requests", async () => {
  const require = createRequire(import.meta.url);
  const ts = require("typescript") as typeof import("typescript");
  const source = ts.transpileModule(readFileSync("lib/collect/admin.ts", "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const requests: budget.RequestAccounting[] = [
    ["queued", "reserved", null, null],
    ["queued", "reserved", "0", null],
    ["running", "reserved", "0.25", null],
    ["running", "provisional", null, "0.1"],
    ["failed", "unreported", null, null],
    ["failed", "unreported", "0.5", null],
    ["succeeded", "provisional", null, "0"],
  ].map(([status, cost_status, reserved, provisional]) => ({
    status, cost_status, cost_reserved_usd: reserved, cost_provisional_usd: provisional,
    cost_final_usd: null, reservation_released_at: null, started_at: null,
  })) as budget.RequestAccounting[];
  const settings = {
    enabled: true, monthly_budget_usd: 10, max_charge_per_run_usd: 1,
    billing_cycle_anchor: "2020-01-01", billing_cycle_length_months: 1, max_concurrent: 5,
  };
  const exports: Record<string, unknown> = {};
  runInNewContext(source, { exports, require: (name: string) => {
    if (name === "../db/privileged.ts") return {
      withTransaction: async (work: (client: unknown) => unknown) => work({
        query: async (sql: string) => ({ rows: sql.includes("app_settings")
          ? Object.entries(settings).map(([key, value]) => ({ key: `collector.${key}`, value }))
          : requests }),
      }),
    };
    if (name === "../auth/role-model.ts") return roles;
    if (name === "./budget.ts") return budget;
    if (name === "./queue.ts") return { ADMISSION_LOCK_NAMESPACE: "pt_glory.collector.admission" };
    if (name === "./admission.ts") return { ABSOLUTE_MAX_RECORDS: 100_000 };
    if (name === "../collector/contract.ts") return { MAX_BYTES: 100_000_000 };
    throw new Error(`Unexpected import: ${name}`);
  } });
  const readUsage = exports.readCollectorUsage as (actor: roles.Actor) => Promise<{
    counts: { held: number; provisional: number; unreported: number };
    heldReservationUsd: string; containsProvisional: boolean;
  }>;
  const usage = await readUsage({ userId: "admin", role: "admin" });
  assert.equal(usage.counts.held, 3);
  assert.equal(usage.heldReservationUsd, "0.850000");
  assert.equal(usage.counts.provisional, 2, "provisional diagnostics include zero holds");
  assert.equal(usage.counts.unreported, 2, "unreported diagnostics include missing reservations");
  assert.equal(usage.containsProvisional, true);
});

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

test("a stored token with a trailing newline still matches, and only itself", () => {
  const previous = process.env.COLLECTION_ADVANCE_TOKEN;
  process.env.COLLECTION_ADVANCE_TOKEN = `${SECRET}\r\n`;
  try {
    assert.equal(authenticateCollectionAdvance(`Bearer ${SECRET}`), "ok");
    assert.equal(authenticateCollectionAdvance(`Bearer ${SECRET.slice(0, -1)}`), "unauthorized");
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
