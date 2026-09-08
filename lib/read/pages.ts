import { dbUser } from "../db/user.ts";
import { scopeArgs, type PageScope, type PageSignal } from "../pages/scope.ts";

/**
 * Page Intelligence read side.
 *
 * Same contract as lib/read/queries.ts: every call goes through the user's
 * Supabase client, so RLS is the boundary, and the SQL lives in migration 0026
 * so the scope rule has exactly one definition shared by these callers and the
 * integration tests.
 *
 * Nothing in here derives a number. Each function is a projection of stored
 * observations, and each row carries the denominator it was computed from.
 */

export type PageListRow = {
  page_id: string;
  page_name: string | null;
  page_categories: string[] | null;
  page_like_count: number | null;
  observed_ads: number;
  active_ads: number;
  inactive_ads: number;
  unknown_ads: number;
  recently_found: number;
  evergreen_ads: number;
  reused_ads: number;
  max_collation: number | null;
  first_observed_at: string | null;
  last_observed_at: string | null;
  total_count: number;
};

export type PageDetailRow = {
  page_id: string;
  page_profile_numeric_id: string | null;
  page_profile_uri: string | null;
  page_name: string | null;
  page_categories: string[] | null;
  page_like_count: number | null;
  observed_ads: number;
  active_ads: number;
  inactive_ads: number;
  unknown_ads: number;
  /** First observed by us, within this scope. */
  recently_found: number;
  /** Meta's start date, within this scope. A different fact. */
  started_recently: number;
  evergreen_ads: number;
  reused_ads: number;
  max_collation: number | null;
  oldest_start_date: string | null;
  newest_start_date: string | null;
  first_observed_at: string | null;
  last_observed_at: string | null;
  runs_in_scope: number;
};

export type CreativeMixRow = {
  dimension: "display_format" | "cta_type" | "publisher_platform" | "page_category";
  value: string;
  n: number;
  /** Ads in which this dimension was readable at all. */
  covered: number;
  /** Ads in scope for this page. The denominator behind "coverage". */
  observed: number;
  /** False for multi-value dimensions, whose shares may exceed 100%. */
  exclusive: boolean;
};

export type ActivityPoint = {
  bucket_start: string;
  first_seen_ads: number;
  started_ads: number;
};

export type LikeHistoryRow = {
  observed_at: string;
  collection_run_id: string;
  page_like_count: number | null;
  page_name: string | null;
};

export type PageAdRow = {
  ad_archive_id: string; is_active: boolean | null; display_format: string | null;
  publisher_platform: string[]; cta_type: string | null; cta_text: string | null;
  title: string | null; body_text: string | null; page_id: string;
  page_name: string | null; page_categories: string[] | null;
  start_date: string; collation_count: number | null;
  first_seen_at: string; last_seen_at: string; ad_age_days: number;
  media: { images?: unknown[]; videos?: unknown[]; cards?: unknown[] } | null;
  archive_path: string | null; archive_status: string | null;
  total_count: number;
};

export type PageListOptions = {
  search?: string | null;
  active?: string | null;
  category?: string | null;
  recentDays?: number;
  sort?: string;
  limit?: number;
  offset?: number;
};

export async function getPageList(
  scope: PageScope,
  options: PageListOptions = {},
): Promise<{ rows: PageListRow[]; total: number }> {
  const supabase = await dbUser();
  const { data, error } = await supabase.rpc("page_list", {
    ...scopeArgs(scope),
    p_search: options.search ?? null,
    p_active: options.active ?? null,
    p_category: options.category ?? null,
    p_recent_days: options.recentDays ?? 30,
    p_sort: options.sort ?? "observed_ads",
    p_limit: options.limit ?? 30,
    p_offset: options.offset ?? 0,
  });
  if (error) throw error;
  const rows = (data ?? []) as PageListRow[];
  return { rows, total: rows[0] ? Number(rows[0].total_count) : 0 };
}

export async function getPageDetail(
  scope: PageScope,
  pageId: string,
  recentDays = 30,
): Promise<PageDetailRow | null> {
  const supabase = await dbUser();
  const { data, error } = await supabase.rpc("page_detail", {
    ...scopeArgs(scope), p_page_id: pageId, p_recent_days: recentDays,
  });
  if (error) throw error;
  // No row means this page is not in the scope. The caller answers 404; it must
  // never widen the scope to find something to show.
  return (data as PageDetailRow[])[0] ?? null;
}

export async function getPageCreativeMix(
  scope: PageScope,
  pageId: string,
): Promise<CreativeMixRow[]> {
  const supabase = await dbUser();
  const { data, error } = await supabase.rpc("page_creative_mix", {
    ...scopeArgs(scope), p_page_id: pageId,
  });
  if (error) throw error;
  return (data ?? []) as CreativeMixRow[];
}

export async function getPageActivity(
  scope: PageScope,
  pageId: string,
  bucket: "day" | "week" = "week",
): Promise<ActivityPoint[]> {
  const supabase = await dbUser();
  const { data, error } = await supabase.rpc("page_activity", {
    ...scopeArgs(scope), p_page_id: pageId, p_bucket: bucket,
  });
  if (error) throw error;
  return (data ?? []) as ActivityPoint[];
}

export async function getPageLikeHistory(
  scope: PageScope,
  pageId: string,
): Promise<LikeHistoryRow[]> {
  const supabase = await dbUser();
  const { data, error } = await supabase.rpc("page_like_history", {
    ...scopeArgs(scope), p_page_id: pageId,
  });
  if (error) throw error;
  return (data ?? []) as LikeHistoryRow[];
}

export type PageAdsOptions = {
  signal?: PageSignal | null;
  recentDays?: number;
  format?: string | null;
  cta?: string | null;
  platform?: string | null;
  sort?: string;
  limit?: number;
  offset?: number;
};

export async function getPageAds(
  scope: PageScope,
  pageId: string,
  options: PageAdsOptions = {},
): Promise<{ rows: PageAdRow[]; total: number }> {
  const supabase = await dbUser();
  const { data, error } = await supabase.rpc("page_ads", {
    ...scopeArgs(scope),
    p_page_id: pageId,
    p_signal: options.signal ?? null,
    p_recent_days: options.recentDays ?? 30,
    p_format: options.format ?? null,
    p_cta: options.cta ?? null,
    p_platform: options.platform ?? null,
    p_sort: options.sort ?? "started_desc",
    p_limit: options.limit ?? 30,
    p_offset: options.offset ?? 0,
  });
  if (error) throw error;
  const rows = (data ?? []) as PageAdRow[];
  return { rows, total: rows[0] ? Number(rows[0].total_count) : 0 };
}
