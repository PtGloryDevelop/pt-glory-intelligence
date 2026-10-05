import "server-only";
import { getOwnedPerformance } from "./performance-read.ts";
import type { OwnedPerformancePeriod, OwnedPerformanceSummary } from "./performance.ts";

export type UnitTotals = Pick<OwnedPerformanceSummary, "ad_count" | "spend" | "conversations" | "purchase_value" | "roas" | "cost_per_conversation">;
export type UnitSummaryRow = { id: string | null; name: string; current: UnitTotals | null; previous: UnitTotals | null };
export type UnitSummary = {
  period: OwnedPerformancePeriod; previous: OwnedPerformancePeriod | null; currency: string;
  total: UnitTotals | null; units: UnitSummaryRow[]; unassigned: { spend: number | null; share: number | null };
};

const pick = (summary: OwnedPerformanceSummary[] | undefined, currency: string): UnitTotals | null => {
  const s = summary?.find(item => item.currency === currency);
  return s ? { ad_count: s.ad_count, spend: s.spend, conversations: s.conversations, purchase_value: s.purchase_value, roas: s.roas, cost_per_conversation: s.cost_per_conversation } : null;
};

// ponytail: one existing RPC per unit, run in parallel and cached per snapshot+period (data changes once a day).
// Upgrade path: a single grouped SQL function if first-load time (~5s for 24 units) becomes a problem.
// Shared across callers: only analyst/admin reach this (ownedReportRoute) and owned data is role-scoped, not per-user.
const cache = new Map<string, { until: number; value: UnitSummary }>();
const TTL = 30 * 60_000;

/** Same filters as the ads list (period/from/to) so the table and the list always describe one window. */
export async function getUnitSummary(input: URLSearchParams, currency = "THB"): Promise<UnitSummary> {
  const params = new URLSearchParams({ compare: "1" });
  for (const key of ["period", "from", "to"]) { const value = input.get(key); if (value) params.set(key, value); }
  const base = await getOwnedPerformance(params);
  const key = `${base.snapshot?.id}:${base.period.from}:${base.period.to}:${currency}`;
  const hit = cache.get(key);
  if (hit && hit.until > Date.now()) return hit.value;

  const units = await Promise.all(base.filters.units.map(async unit => {
    const data = await getOwnedPerformance(new URLSearchParams({ ...Object.fromEntries(params), unit: unit.id }));
    return { id: unit.id, name: unit.name, current: pick(data.summary, currency), previous: pick(data.previous?.summary, currency) };
  }));
  const total = pick(base.summary, currency);
  const assigned = units.reduce((sum, row) => sum + (row.current?.spend ?? 0), 0);
  const unassignedSpend = total?.spend != null ? Math.max(0, total.spend - assigned) : null;
  const value: UnitSummary = {
    period: base.period, previous: base.previous?.period ?? null, currency, total,
    units: units.filter(row => (row.current?.spend ?? 0) > 0).sort((a, b) => (b.current?.spend ?? 0) - (a.current?.spend ?? 0)),
    unassigned: { spend: unassignedSpend, share: unassignedSpend != null && total?.spend ? unassignedSpend / total.spend * 100 : null },
  };
  if (cache.size > 50) cache.clear();
  cache.set(key, { until: Date.now() + TTL, value });
  return value;
}
