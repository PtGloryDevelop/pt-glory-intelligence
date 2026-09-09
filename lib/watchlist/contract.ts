import { parseScope, scopeToParam, type PageScope } from "../pages/scope.ts";

/**
 * What a saved watch is, and — as much of this file is about — what it is not.
 *
 * Watchlist V1 saves research targets. It does not monitor anything: nothing
 * evaluates a watch on a schedule, no notification is ever sent, and no event is
 * stored. Every number is computed when somebody opens the page. The wording
 * here exists so no surface can accidentally promise otherwise.
 */

export const WATCH_SIGNALS = [
  "PAGE_NEWLY_FOUND_AD",
  "PAGE_STARTED_AD",
  "PAGE_STATUS_OBSERVED_CHANGE",
  "PAGE_NEW_FORMAT_OBSERVED",
  "PAGE_NEW_CTA_OBSERVED",
  "PAGE_REUSE_CHANGED",
  "CATEGORY_NEWLY_FOUND_AD",
] as const;

export type WatchSignal = (typeof WATCH_SIGNALS)[number];
export type WatchTargetType = "page" | "category";

export function watchSignal(raw: string | null | undefined): WatchSignal | null {
  return (WATCH_SIGNALS as readonly string[]).includes(raw ?? "")
    ? (raw as WatchSignal)
    : null;
}

/**
 * Each signal's kind decides how it may be read.
 *
 *   event           something happened between the baseline and now
 *   state           what was true then, against what is true now
 *   first_observed  a value we had not seen in this scope before the baseline
 *
 * A state has no meaning without a newer observation, which is why the summary
 * carries `new_observations` and the UI refuses to call zero "no change".
 */
export const SIGNAL_META: Record<WatchSignal, {
  kind: "event" | "state" | "first_observed";
  target: WatchTargetType;
  label: string;
  helper: string;
  /** The unit the count is in — always what the evidence returns. */
  unit: string;
}> = {
  PAGE_NEWLY_FOUND_AD: {
    kind: "event", target: "page",
    label: "Ads ที่ PT Glory พบครั้งแรกหลังจุดอ้างอิง",
    helper: "นับจากวันที่เราเห็นโฆษณาครั้งแรก (ทุกรอบเก็บ) — ไม่ได้แปลว่าเพจเพิ่งเริ่มยิง",
    unit: "โฆษณา",
  },
  PAGE_STARTED_AD: {
    kind: "event", target: "page",
    label: "Ads ที่ Meta ระบุว่าเริ่มแสดงหลังจุดอ้างอิง",
    helper: "วันที่ Meta ระบุ — คนละค่ากับวันที่เราพบ",
    unit: "โฆษณา",
  },
  PAGE_STATUS_OBSERVED_CHANGE: {
    kind: "state", target: "page",
    label: "สถานะที่เราพบเปลี่ยนไป",
    helper: "เทียบการสังเกต ณ จุดอ้างอิง กับการสังเกตล่าสุด — ไม่ใช่เวลาที่โฆษณาหยุดจริง",
    unit: "โฆษณา",
  },
  PAGE_NEW_FORMAT_OBSERVED: {
    kind: "first_observed", target: "page",
    label: "พบ Format ใหม่หลังจุดอ้างอิง",
    helper: "รูปแบบที่ไม่เคยพบในขอบเขตนี้ก่อนจุดอ้างอิง",
    unit: "โฆษณา",
  },
  PAGE_NEW_CTA_OBSERVED: {
    kind: "first_observed", target: "page",
    label: "พบ CTA ใหม่หลังจุดอ้างอิง",
    helper: "เริ่มพบ CTA นี้ในข้อมูลที่อ่านค่าได้ — ถ้าก่อนหน้านี้อ่าน CTA ไม่ได้ ก็ไม่ได้แปลว่าไม่เคยมี",
    unit: "โฆษณา",
  },
  PAGE_REUSE_CHANGED: {
    kind: "state", target: "page",
    label: "ค่า collation เปลี่ยนไป",
    helper: "เทียบการสังเกตสองครั้ง — ไม่ได้แปลว่าไฟล์เหมือนกัน และไม่ได้บอกผลลัพธ์",
    unit: "โฆษณา",
  },
  CATEGORY_NEWLY_FOUND_AD: {
    kind: "event", target: "category",
    label: "Ads ในหมวดนี้ที่ PT Glory พบครั้งแรกหลังจุดอ้างอิง",
    helper: "นับโฆษณาที่ไม่ซ้ำกัน — ไม่ได้แปลว่าตลาดโตขึ้น",
    unit: "โฆษณา",
  },
};

export const PAGE_SIGNALS = WATCH_SIGNALS.filter((s) => SIGNAL_META[s].target === "page");
export const CATEGORY_SIGNALS = WATCH_SIGNALS.filter((s) => SIGNAL_META[s].target === "category");

/**
 * Restrained defaults: a watch that tracks everything is a report nobody reads.
 * The rest are one checkbox away.
 */
export const DEFAULT_PAGE_SIGNALS: WatchSignal[] = ["PAGE_NEWLY_FOUND_AD", "PAGE_STARTED_AD"];
export const DEFAULT_CATEGORY_SIGNALS: WatchSignal[] = ["CATEGORY_NEWLY_FOUND_AD"];

/** Signals a target type is allowed to track. Anything else is refused. */
export function signalsFor(target: WatchTargetType): readonly WatchSignal[] {
  return target === "page" ? PAGE_SIGNALS : CATEGORY_SIGNALS;
}

export function normalizeSignals(
  target: WatchTargetType,
  raw: unknown,
): { ok: true; value: WatchSignal[] } | { ok: false; reason: string } {
  if (!Array.isArray(raw)) return { ok: false, reason: "signals must be a list" };
  const allowed = signalsFor(target);
  const value: WatchSignal[] = [];
  for (const entry of raw) {
    const signal = watchSignal(typeof entry === "string" ? entry : null);
    if (!signal) return { ok: false, reason: `unknown signal: ${String(entry)}` };
    if (!allowed.includes(signal)) {
      return { ok: false, reason: `${signal} does not apply to a ${target} watch` };
    }
    if (!value.includes(signal)) value.push(signal);
  }
  if (value.length === 0) return { ok: false, reason: "choose at least one signal" };
  return { ok: true, value };
}

/* ------------------------------------------------------------------- scope */

export type WatchScope =
  | { kind: "dataset"; datasetId: string }
  | { kind: "category"; categoryId: string }
  | { kind: "all" };

/** The stored columns for a scope. Explicit, never inferred from context. */
export function scopeColumns(scope: WatchScope) {
  return {
    scope_kind: scope.kind,
    scope_dataset_id: scope.kind === "dataset" ? scope.datasetId : null,
    scope_category_id: scope.kind === "category" ? scope.categoryId : null,
  };
}

export function watchScopeFromPageScope(scope: PageScope): WatchScope {
  if (scope.kind === "all") return { kind: "all" };
  if (scope.kind === "dataset") return { kind: "dataset", datasetId: scope.id };
  return { kind: "category", categoryId: scope.id };
}

export function pageScopeFromWatch(row: {
  scope_kind: string; scope_dataset_id: string | null; scope_category_id: string | null;
}): PageScope | null {
  if (row.scope_kind === "all") return { kind: "all" };
  if (row.scope_kind === "dataset" && row.scope_dataset_id) {
    return { kind: "dataset", id: row.scope_dataset_id };
  }
  if (row.scope_kind === "category" && row.scope_category_id) {
    return { kind: "category", id: row.scope_category_id };
  }
  return null;
}

export function watchScopeParam(row: {
  scope_kind: string; scope_dataset_id: string | null; scope_category_id: string | null;
}): string {
  const scope = pageScopeFromWatch(row);
  return scope ? scopeToParam(scope) : "all";
}

export function parseWatchScope(raw: string | null | undefined): WatchScope | null {
  const scope = parseScope(raw);
  return scope ? watchScopeFromPageScope(scope) : null;
}

/**
 * A dataset scope is a snapshot: one collection run, fixed forever.
 *
 * Saving one is a legitimate research bookmark, but there is nothing for a
 * baseline to measure — no later run can add to it, and using observations from
 * outside the dataset would silently rewrite what the dataset says. So the
 * changes panel is unavailable by design rather than empty by accident.
 */
export function isSnapshotScope(scopeKind: string): boolean {
  return scopeKind === "dataset";
}

export const SNAPSHOT_NOTE =
  "ขอบเขตนี้เป็น Snapshot ของ Dataset — ค่าหลักจะไม่เปลี่ยนจากรอบเก็บอื่น " +
  "จึงไม่มีส่วน “ตั้งแต่จุดอ้างอิง” ให้ดู";

/* ---------------------------------------------------------------- wording */

/**
 * What a state signal means when nothing has been collected since the baseline.
 *
 * "No change" would be a claim about the advertiser. "No new observation" is a
 * fact about us, and it is the true one.
 */
export function stateNote(newObservations: number): string | null {
  return newObservations === 0
    ? "ยังไม่มี observation ใหม่หลังจุดอ้างอิง — ไม่ใช่ว่าไม่มีการเปลี่ยนแปลง"
    : null;
}

export const BASELINE_RESET_EXPLANATION =
  "หลังตั้งจุดอ้างอิงใหม่ รายการ “ตั้งแต่จุดอ้างอิง” จะเริ่มนับจากเวลานี้ " +
  "ระบบไม่ได้เก็บประวัติการเปลี่ยนแปลงไว้ ของเดิมจะไม่ถูกนับอีก";

/**
 * The sentence that keeps the feature honest, shown wherever a watch is.
 *
 * Collection is not continuous, so "new" here always means new since our latest
 * collection — never that an advertiser just did something.
 */
export const WATCHLIST_BASIS =
  "รายการติดตามเป็นการบันทึกเป้าหมายไว้ตรวจดูเอง ไม่ใช่การเฝ้าดูอัตโนมัติ " +
  "และไม่มีการแจ้งเตือน · ตัวเลขคำนวณสดจากข้อมูลที่เก็บมาแล้ว " +
  "“พบใหม่” จึงหมายถึงใหม่ตั้งแต่รอบเก็บล่าสุดของ PT Glory";
