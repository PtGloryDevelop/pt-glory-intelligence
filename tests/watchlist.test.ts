import assert from "node:assert/strict";
import test from "node:test";
import {
  BASELINE_RESET_EXPLANATION, CATEGORY_SIGNALS, DEFAULT_CATEGORY_SIGNALS,
  DEFAULT_PAGE_SIGNALS, PAGE_SIGNALS, SIGNAL_META, SNAPSHOT_NOTE, WATCHLIST_BASIS,
  WATCH_SIGNALS, isSnapshotScope, normalizeSignals, pageScopeFromWatch,
  parseWatchScope, scopeColumns, stateNote, watchScopeFromPageScope, watchSignal,
} from "../lib/watchlist/contract.ts";

/**
 * The watchlist contract, tested away from the database.
 *
 * Two claims carry the risk here, and neither is arithmetic. The first is that
 * this feature does not monitor anything — a word like "แจ้งเตือน" on any of
 * these surfaces would promise a capability that does not exist. The second is
 * that a state with no newer observation is not an unchanged state.
 */

test("signals are an allowlist, per target type", () => {
  assert.equal(watchSignal("PAGE_NEWLY_FOUND_AD"), "PAGE_NEWLY_FOUND_AD");
  assert.equal(watchSignal("PAGE_PROFIT"), null);
  assert.equal(watchSignal(null), null);

  // A category signal on a page watch would query nothing and show zero, which
  // reads as an answer. It is refused instead.
  const wrong = normalizeSignals("page", ["CATEGORY_NEWLY_FOUND_AD"]);
  assert.equal(wrong.ok, false);
  assert.match((wrong as { reason: string }).reason, /does not apply/);

  const unknown = normalizeSignals("page", ["PAGE_SPEND"]);
  assert.equal(unknown.ok, false);
  assert.match((unknown as { reason: string }).reason, /unknown signal/);

  const empty = normalizeSignals("page", []);
  assert.equal(empty.ok, false);

  const good = normalizeSignals("page", ["PAGE_STARTED_AD", "PAGE_STARTED_AD"]);
  assert.deepEqual(good, { ok: true, value: ["PAGE_STARTED_AD"] });
});

test("page and category signals do not overlap", () => {
  assert.equal(PAGE_SIGNALS.length + CATEGORY_SIGNALS.length, WATCH_SIGNALS.length);
  for (const signal of PAGE_SIGNALS) assert.equal(SIGNAL_META[signal].target, "page");
  for (const signal of CATEGORY_SIGNALS) assert.equal(SIGNAL_META[signal].target, "category");
});

test("defaults are restrained", () => {
  // A watch that tracks everything is a report nobody reads.
  assert.deepEqual(DEFAULT_PAGE_SIGNALS, ["PAGE_NEWLY_FOUND_AD", "PAGE_STARTED_AD"]);
  assert.deepEqual(DEFAULT_CATEGORY_SIGNALS, ["CATEGORY_NEWLY_FOUND_AD"]);
  assert.ok(DEFAULT_PAGE_SIGNALS.length < PAGE_SIGNALS.length);
  assert.equal(normalizeSignals("page", DEFAULT_PAGE_SIGNALS).ok, true);
  assert.equal(normalizeSignals("category", DEFAULT_CATEGORY_SIGNALS).ok, true);
});

test("every signal is classified, and the two clocks stay apart", () => {
  for (const signal of WATCH_SIGNALS) {
    const meta = SIGNAL_META[signal];
    assert.ok(["event", "state", "first_observed"].includes(meta.kind), signal);
    assert.ok(meta.label.length > 0 && meta.helper.length > 0, signal);
  }
  // First-seen is ours; start date is Meta's. Different sentences, on purpose.
  assert.match(SIGNAL_META.PAGE_NEWLY_FOUND_AD.label, /PT Glory/);
  assert.match(SIGNAL_META.PAGE_STARTED_AD.label, /Meta/);
  assert.notEqual(
    SIGNAL_META.PAGE_NEWLY_FOUND_AD.label, SIGNAL_META.PAGE_STARTED_AD.label,
  );
});

test("nothing in the wording promises monitoring", () => {
  const forbidden =
    /real-?time|live monitor|แจ้งเตือน|เฝ้าดูตลอด|อัตโนมัติทันที|alert|push/i;
  /*
   * A denial is not a promise. The basis has to be able to say "ไม่มีการ
   * แจ้งเตือน" — a plain substring scan cannot tell a claim from its refusal,
   * so the denials are removed before scanning for what is left.
   */
  const denials = /ไม่มีการแจ้งเตือน|ไม่ใช่การเฝ้าดูอัตโนมัติ/g;
  const surfaces = [
    WATCHLIST_BASIS, SNAPSHOT_NOTE, BASELINE_RESET_EXPLANATION,
    ...Object.values(SIGNAL_META).flatMap((meta) => [meta.label, meta.helper]),
    stateNote(0) ?? "",
  ];
  for (const text of surfaces) {
    const claims = text.replace(denials, "");
    assert.ok(!forbidden.test(claims), `"${text}" implies monitoring this product does not do`);
  }
  // ...and the basis says outright what it is not.
  assert.match(WATCHLIST_BASIS, /ไม่ใช่การเฝ้าดูอัตโนมัติ/);
  assert.match(WATCHLIST_BASIS, /ไม่มีการแจ้งเตือน/);
});

test("no signal names a metric this product does not have", () => {
  const forbidden = /spend|reach|impression|engagement|ctr|cpc|cpa|roas|conversion|winning|market share/i;
  for (const signal of WATCH_SIGNALS) {
    assert.ok(!forbidden.test(signal));
    assert.ok(!forbidden.test(SIGNAL_META[signal].label));
    assert.ok(!forbidden.test(SIGNAL_META[signal].helper));
  }
});

test("newly found says it is our sighting, not a launch", () => {
  assert.match(SIGNAL_META.PAGE_NEWLY_FOUND_AD.helper, /ไม่ได้แปลว่าเพจเพิ่งเริ่มยิง/);
  assert.match(SIGNAL_META.CATEGORY_NEWLY_FOUND_AD.helper, /ไม่ได้แปลว่าตลาดโตขึ้น/);
  // ...and the basis explains what "new" is measured against.
  assert.match(WATCHLIST_BASIS, /รอบเก็บล่าสุด/);
});

test("a status change is a change in what we observed, not a stop time", () => {
  assert.match(SIGNAL_META.PAGE_STATUS_OBSERVED_CHANGE.helper, /ไม่ใช่เวลาที่โฆษณาหยุดจริง/);
});

test("a new CTA is qualified by whether the CTA was readable before", () => {
  assert.match(SIGNAL_META.PAGE_NEW_CTA_OBSERVED.helper, /อ่าน CTA ไม่ได้/);
});

test("reuse never means performance", () => {
  assert.match(SIGNAL_META.PAGE_REUSE_CHANGED.helper, /ไม่ได้แปลว่าไฟล์เหมือนกัน/);
  assert.match(SIGNAL_META.PAGE_REUSE_CHANGED.helper, /ไม่ได้บอกผลลัพธ์/);
});

/* ------------------------------------------------------------------- state */

test("no new observation is not the same as no change", () => {
  const note = stateNote(0);
  assert.ok(note);
  assert.match(note, /ยังไม่มี observation ใหม่/);
  // The distinction stated outright, because it is the one a reader would
  // otherwise fill in wrongly.
  assert.match(note, /ไม่ใช่ว่าไม่มีการเปลี่ยนแปลง/);

  // With a newer observation there is nothing to qualify.
  assert.equal(stateNote(3), null);
});

/* ------------------------------------------------------------------ scope */

test("a scope round-trips through the stored columns", () => {
  const uuid = "0b6e1f7c-9c1a-4f3e-8b2d-1a2b3c4d5e6f";
  assert.deepEqual(scopeColumns({ kind: "all" }), {
    scope_kind: "all", scope_dataset_id: null, scope_category_id: null,
  });
  assert.deepEqual(scopeColumns({ kind: "dataset", datasetId: uuid }), {
    scope_kind: "dataset", scope_dataset_id: uuid, scope_category_id: null,
  });
  assert.deepEqual(scopeColumns({ kind: "category", categoryId: uuid }), {
    scope_kind: "category", scope_dataset_id: null, scope_category_id: uuid,
  });

  for (const scope of [
    { kind: "all" } as const,
    { kind: "dataset", id: uuid } as const,
    { kind: "category", id: uuid } as const,
  ]) {
    const columns = scopeColumns(watchScopeFromPageScope(scope));
    assert.deepEqual(pageScopeFromWatch(columns), scope);
  }
});

test("a malformed scope is refused rather than widened", () => {
  assert.equal(parseWatchScope("all")?.kind, "all");
  assert.equal(parseWatchScope("dataset:not-a-uuid"), null);
  assert.equal(parseWatchScope(null), null);
  // Nothing falls back to "all": a watch saved against the wrong data would
  // answer a question the user never asked.
  assert.equal(parseWatchScope("everything"), null);
});

test("a dataset scope is a snapshot, and says what that means", () => {
  assert.equal(isSnapshotScope("dataset"), true);
  assert.equal(isSnapshotScope("category"), false);
  assert.equal(isSnapshotScope("all"), false);
  assert.match(SNAPSHOT_NOTE, /Snapshot/);
  assert.match(SNAPSHOT_NOTE, /ไม่มีส่วน/);
});

test("resetting the baseline explains that nothing is kept", () => {
  assert.match(BASELINE_RESET_EXPLANATION, /เริ่มนับจากเวลานี้/);
  // There is no event history, so what stops being counted does not come back.
  assert.match(BASELINE_RESET_EXPLANATION, /ไม่ได้เก็บประวัติ/);
  assert.ok(!/อ่านแล้ว|mark.*read/i.test(BASELINE_RESET_EXPLANATION));
});
