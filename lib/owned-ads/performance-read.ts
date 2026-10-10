import "server-only";
import { dbUser } from "../db/user.ts";
import { cachedOwnedImage } from "./media-cache.ts";
import {
  ownedSortArg, parseOwnedPerformanceQuery, ownedPerformancePeriod, previousOwnedPerformancePeriod, OwnedPerformanceQueryError, OWNED_MEDIA_KEY,
  type OwnedMediaMembers, type OwnedPerformanceData, type OwnedPerformancePeriod,
} from "./performance.ts";

/** JWT/RLS read only. Reused by the API and exact-snapshot comparison; no source/provider calls. */
export async function getOwnedPerformance(params: URLSearchParams, snapshotId?: string): Promise<OwnedPerformanceData> {
  const query = parseOwnedPerformanceQuery(params);
  if (snapshotId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(snapshotId)) {
    throw new OwnedPerformanceQueryError("ชุดข้อมูลแอดไม่ถูกต้อง");
  }
  const db = await dbUser();
  let selection = db.from("owned_library_syncs").select("id,finished_at,source_snapshot_at,ad_count,date_start,date_end,daily_ready,daily_from,daily_to")
    .eq("status", "completed");
  if (snapshotId) selection = selection.eq("id", snapshotId);
  const latest = await selection.order("finished_at", { ascending: false }).limit(1).maybeSingle();
  if (latest.error) throw new Error("Owned daily snapshot unavailable");
  const stored = latest.data;
  const coverage = stored?.daily_from && stored?.daily_to ? { from: stored.daily_from, to: stored.daily_to } : null;
  const period = ownedPerformancePeriod(query, coverage);
  const snapshot = stored ? {
    id: stored.id, finished_at: stored.finished_at, source_snapshot_at: stored.source_snapshot_at,
    ad_count: stored.ad_count, date_start: stored.date_start, date_end: stored.date_end,
  } : null;
  const output: OwnedPerformanceData = {
    ready: Boolean(stored?.daily_ready), snapshot, coverage, period,
    filters: { units: [], pages: [] }, summary: [], rows: [], total: 0, page: query.page, pageSize: 24,
  };
  if (!output.ready) return output;
  const previous = query.compare ? previousOwnedPerformancePeriod(period) : undefined;
  const read = (dates: OwnedPerformancePeriod, page: number) => db.rpc(query.media ? "owned_media_page" : "owned_performance_page", {
    p_sync: stored!.id, p_from: dates.from, p_to: dates.to, p_unit: query.unit, p_page_id: query.pageId,
    p_search: query.q, p_sort: ownedSortArg(query), p_status: query.status, p_page: page,
  });
  const [current, prior] = await Promise.all([read(period, query.page), previous ? read(previous, 0) : Promise.resolve(null)]);
  if (current.error || prior?.error) throw new Error("Owned daily performance unavailable");
  const lastPage = Math.max(0, Math.ceil(current.data.total / output.pageSize) - 1);
  if (query.page > lastPage) {
    const corrected = await read(period, lastPage);
    if (corrected.error) throw new Error("Owned daily performance unavailable");
    Object.assign(output, corrected.data, { page: lastPage });
  } else Object.assign(output, current.data);
  output.rows = output.rows.map(row => ({ ...row, creative_url: cachedOwnedImage(row) ?? null }));
  if (previous && prior) output.previous = { period: previous, summary: prior.data.summary };
  return output;
}

/** The ads behind one creative row, read with the page's own filters and period. */
export async function getOwnedMediaMembers(params: URLSearchParams): Promise<OwnedMediaMembers> {
  const query = parseOwnedPerformanceQuery(params);
  const key = params.get("media_key") ?? "";
  if (params.getAll("media_key").length !== 1 || !OWNED_MEDIA_KEY.test(key)) throw new OwnedPerformanceQueryError("สื่อที่เลือกไม่ถูกต้อง");
  const db = await dbUser();
  const latest = await db.from("owned_library_syncs").select("id,daily_ready,daily_from,daily_to")
    .eq("status", "completed").order("finished_at", { ascending: false }).limit(1).maybeSingle();
  if (latest.error) throw new Error("Owned daily snapshot unavailable");
  if (!latest.data?.daily_ready) return { total: 0, rows: [] };
  const coverage = latest.data.daily_from && latest.data.daily_to ? { from: latest.data.daily_from, to: latest.data.daily_to } : null;
  const period = ownedPerformancePeriod(query, coverage);
  const result = await db.rpc("owned_media_members", {
    p_sync: latest.data.id, p_from: period.from, p_to: period.to, p_unit: query.unit, p_page_id: query.pageId,
    p_search: query.q, p_status: query.status, p_media_key: key,
  });
  if (result.error) throw new Error("Owned media members unavailable");
  const data = result.data as OwnedMediaMembers;
  return { total: data.total, rows: data.rows.map(row => ({ ...row, creative_url: cachedOwnedImage(row) ?? null })) };
}
