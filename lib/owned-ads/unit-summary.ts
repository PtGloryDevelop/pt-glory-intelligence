import "server-only";
import { dbUser } from "../db/user.ts";
import { ownedPerformancePeriod, parseOwnedPerformanceQuery, previousOwnedPerformancePeriod, type OwnedPerformancePeriod, type OwnedPerformanceSummary } from "./performance.ts";

export type UnitTotals = Pick<OwnedPerformanceSummary, "ad_count" | "spend" | "conversations" | "purchase_value" | "roas" | "cost_per_conversation">;
export type UnitSummaryRow = { id: string | null; name: string; current: UnitTotals | null; previous: UnitTotals | null };
export type UnitSummary = {
  period: OwnedPerformancePeriod; previous: OwnedPerformancePeriod | null; currency: string;
  total: UnitTotals | null; units: UnitSummaryRow[]; unassigned: { spend: number | null; share: number | null; totals: UnitTotals | null };
};
type RpcRow = UnitTotals & { id: string | null; name: string | null; currency: string };

const totals = (row: RpcRow | undefined): UnitTotals | null => row ? {
  ad_count: Number(row.ad_count), spend: row.spend == null ? null : Number(row.spend), conversations: row.conversations == null ? null : Number(row.conversations),
  purchase_value: row.purchase_value == null ? null : Number(row.purchase_value), roas: row.roas == null ? null : Number(row.roas),
  cost_per_conversation: row.cost_per_conversation == null ? null : Number(row.cost_per_conversation),
} : null;

// Cached per snapshot+period: the daily data changes once per import. Shared across callers is safe:
// only analyst/admin reach this (ownedReportRoute) and owned data is role-scoped, not per-user.
const cache = new Map<string, { until: number; value: UnitSummary }>();
const TTL = 30 * 60_000;

/** Same window as the ads list (period/from/to): one snapshot lookup + one grouped read per period (migration 0054). */
export async function getUnitSummary(input: URLSearchParams, currency = "THB"): Promise<UnitSummary> {
  const params = new URLSearchParams();
  for (const key of ["period", "from", "to"]) { const value = input.get(key); if (value) params.set(key, value); }
  const query = parseOwnedPerformanceQuery(params);
  const db = await dbUser();
  const latest = await db.from("owned_library_syncs").select("id,daily_ready,daily_from,daily_to").eq("status", "completed").order("finished_at", { ascending: false }).limit(1).maybeSingle();
  if (latest.error) throw new Error("Owned daily snapshot unavailable");
  const coverage = latest.data?.daily_from && latest.data?.daily_to ? { from: latest.data.daily_from as string, to: latest.data.daily_to as string } : null;
  const period = ownedPerformancePeriod(query, coverage), previous = previousOwnedPerformancePeriod(period);
  const empty: UnitSummary = { period, previous, currency, total: null, units: [], unassigned: { spend: null, share: null, totals: null } };
  if (!latest.data?.daily_ready) return empty;
  const key = `${latest.data.id}:${period.from}:${period.to}:${currency}`;
  const hit = cache.get(key);
  if (hit && hit.until > Date.now()) return hit.value;

  const read = (dates: OwnedPerformancePeriod) => db.rpc("owned_performance_units", { p_sync: latest.data!.id, p_from: dates.from, p_to: dates.to });
  const [now, before] = await Promise.all([read(period), read(previous)]);
  if (now.error || before.error) throw new Error("Owned unit summary unavailable");
  const current = (now.data as RpcRow[]).filter(row => row.currency === currency);
  const prior = new Map(((before.data ?? []) as RpcRow[]).filter(row => row.currency === currency).map(row => [row.id, row]));

  const units = current.filter(row => row.id != null && Number(row.spend) > 0)
    .map(row => ({ id: row.id, name: row.name ?? row.id!, current: totals(row), previous: totals(prior.get(row.id)) }));
  const none = totals(current.find(row => row.id == null));
  // Total = every group's spend (units + unassigned); null if any group's sum is unknown.
  const sum = current.every(row => row.spend != null) ? current.reduce((total, row) => total + Number(row.spend), 0) : null;
  const value: UnitSummary = {
    ...empty, units, total: sum == null ? null : { ad_count: 0, spend: sum, conversations: null, purchase_value: null, roas: null, cost_per_conversation: null },
    unassigned: { spend: none?.spend ?? 0, share: none?.spend != null && sum ? none.spend / sum * 100 : null, totals: none },
  };
  if (cache.size > 50) cache.clear();
  cache.set(key, { until: Date.now() + TTL, value });
  return value;
}
