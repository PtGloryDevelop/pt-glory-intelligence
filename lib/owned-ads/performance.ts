import type { CompanyAd } from "./source-rows.ts";
import type { OwnedMetric } from "./model.ts";
import { OWNED_LIBRARY_STATUSES } from "./library-query.ts";

export const OWNED_PERIOD_PRESETS = ["3d", "7d", "14d", "this-month", "last-month", "all", "custom", "today", "yesterday"] as const;
export type OwnedPeriodPreset = typeof OWNED_PERIOD_PRESETS[number];
export const OWNED_PERFORMANCE_SORTS = ["spend", "cost_per_conversation", "roas", "conversations", "hook_rate", "newest", "longest"] as const;
export type OwnedPerformanceSort = typeof OWNED_PERFORMANCE_SORTS[number];
export const OWNED_PERFORMANCE_STATUSES = [...OWNED_LIBRARY_STATUSES, ["WITH_ISSUES", "มีปัญหา"]] as const;
export type OwnedPerformancePeriod = { from: string; to: string };
export type OwnedPerformanceQuery = {
  period: OwnedPeriodPreset; from: string; to: string; unit: string; pageId: string;
  q: string; status: string; sort: OwnedPerformanceSort; page: number; compare: boolean;
};
export type OwnedPerformanceRow = CompanyAd & {
  unit_ids: string[]; unit_names: string[]; hook_rate: number | null; cost_per_conversation: number | null;
  delivery_first: string | null; delivery_last: string | null; delivery_days: number | null;
  creative_id: string | null; video_id: string | null; created_time: string | null;
};
export type OwnedPerformanceSummary = {
  currency: string; ad_count: number; daily_rows: number; spend: number | null; conversations: number | null;
  purchases: number | null; purchase_value: number | null; impressions: number | null; video_views: number | null;
  roas: number | null; cost_per_conversation: number | null; hook_rate: number | null; close_rate: null;
  coverage: Record<"spend" | "conversations" | "purchase_value" | "roas" | "hook_rate", Pick<OwnedMetric, "present" | "total">>;
};
export type OwnedPerformanceData = {
  ready: boolean;
  snapshot: { id: string; finished_at: string; source_snapshot_at: string | null; ad_count: number; date_start: string; date_end: string } | null;
  coverage: OwnedPerformancePeriod | null; period: OwnedPerformancePeriod;
  filters: { units: { id: string; name: string }[]; pages: { id: string; name: string }[] };
  summary: OwnedPerformanceSummary[]; rows: OwnedPerformanceRow[]; total: number; page: number; pageSize: number;
  previous?: { period: OwnedPerformancePeriod; summary: OwnedPerformanceSummary[] };
};

export class OwnedPerformanceQueryError extends Error {}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function isOwnedPerformanceDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith("0000")) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
const shift = (date: string, days: number): string => {
  const next = new Date(`${date}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + days);
  const result = next.toISOString().slice(0, 10);
  if (!isOwnedPerformanceDate(result)) throw new OwnedPerformanceQueryError("ช่วงวันที่อยู่นอกขอบเขตที่รองรับ");
  return result;
};

/** Presets use the Bangkok calendar, including today. Source coverage never moves a preset. */
export function parseOwnedPerformanceQuery(params: URLSearchParams): OwnedPerformanceQuery {
  for (const key of ["period", "from", "to", "unit", "pageId", "q", "status", "sort", "page", "compare"]) {
    if (params.getAll(key).length > 1) throw new OwnedPerformanceQueryError("ตัวกรองซ้ำกัน");
  }
  const period = params.get("period") ?? "7d";
  const sort = params.get("sort") ?? "spend";
  const pageText = params.get("page") ?? "0";
  const page = Number(pageText);
  const unit = params.get("unit") ?? "";
  const pageId = params.get("pageId") ?? "";
  const q = (params.get("q") ?? "").trim();
  const status = params.get("status") ?? "";
  const from = params.get("from") ?? "";
  const to = params.get("to") ?? "";
  const compare = params.get("compare") ?? "0";
  if (!(OWNED_PERIOD_PRESETS as readonly string[]).includes(period) || !(OWNED_PERFORMANCE_SORTS as readonly string[]).includes(sort)
    || !/^\d+$/.test(pageText) || !Number.isSafeInteger(page) || page > 100000 || q.length > 160
    || (unit !== "" && !UUID.test(unit)) || (pageId !== "" && !/^\d{1,32}$/.test(pageId))
    || (status !== "" && !OWNED_PERFORMANCE_STATUSES.some(([value]) => value === status))
    || !["0", "1"].includes(compare) || (from !== "" && !isOwnedPerformanceDate(from)) || (to !== "" && !isOwnedPerformanceDate(to))
    || (period === "custom" && (!from || !to || from > to))) {
    throw new OwnedPerformanceQueryError("ตัวกรองหรือช่วงวันที่ไม่ถูกต้อง");
  }
  return { period: period as OwnedPeriodPreset, from, to, unit: unit.toLowerCase(), pageId, q, status, sort: sort as OwnedPerformanceSort, page, compare: compare === "1" };
}

export function ownedPerformancePeriod(query: OwnedPerformanceQuery, coverage: OwnedPerformancePeriod | null, now = new Date()): OwnedPerformancePeriod {
  const today = new Date(now.getTime() + 7 * 3600000).toISOString().slice(0, 10);
  const month = `${today.slice(0, 7)}-01`;
  switch (query.period) {
    case "custom": return { from: query.from, to: query.to };
    case "all": return coverage ?? { from: today, to: today };
    case "today": return { from: today, to: today };
    case "yesterday": return { from: shift(today, -1), to: shift(today, -1) };
    case "this-month": return { from: month, to: today };
    case "last-month": { const to = shift(month, -1); return { from: `${to.slice(0, 7)}-01`, to }; }
    default: {
      // Rolling windows end on the last finished day that has data, so a 7-day view never counts
      // unimported or unfinished days as zeros against a complete previous window.
      const yesterday = shift(today, -1);
      const to = coverage && coverage.to < yesterday ? coverage.to : yesterday;
      return { from: shift(to, -(Number(query.period.slice(0, -1)) - 1)), to };
    }
  }
}

/** Equal inclusive length, ending immediately before the current period. */
export function previousOwnedPerformancePeriod(period: OwnedPerformancePeriod): OwnedPerformancePeriod {
  const days = Math.round((Date.parse(period.to) - Date.parse(period.from)) / 86400000) + 1;
  return { from: shift(period.from, -days), to: shift(period.from, -1) };
}
