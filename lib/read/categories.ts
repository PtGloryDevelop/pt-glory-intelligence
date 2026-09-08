import { dbUser } from "../db/user.ts";
import type { CreativeMixRow, PageAdRow } from "./pages.ts";
import type { PageSignal } from "../pages/scope.ts";

/**
 * Category workspace read side.
 *
 * Same contract as the rest of the read layer: the user's Supabase client, RLS
 * as the boundary, and all of the SQL in migration 0028 so the "current view"
 * rule has exactly one definition shared by the overview, the ranking, the
 * mixes, the signals and the tests.
 *
 * `page_categories` on these rows is META's label for a page, never this
 * product's research category.
 */

export type CategoryListRow = {
  category_id: string;
  category_name: string;
  dataset_count: number;
  observed_ads: number;
  observed_pages: number;
  first_collected_at: string | null;
  last_collected_at: string | null;
};

export type CategoryDetailRow = {
  category_id: string;
  category_name: string;
  dataset_count: number;
  run_count: number;
  observed_ads: number;
  observed_pages: number;
  active_ads: number;
  inactive_ads: number;
  unknown_ads: number;
  /** First observed by us. */
  recently_found: number;
  /** Meta's start date. A different fact. */
  started_recently: number;
  evergreen_ads: number;
  reused_ads: number;
  evergreen_threshold_days: number;
  first_collected_at: string | null;
  last_collected_at: string | null;
};

export type CategoryDatasetRow = {
  dataset_id: string;
  dataset_name: string;
  collection_run_id: string;
  collected_at: string;
  run_status: string;
  scope_query: string | null;
  scope_country: string | null;
  ads_in_dataset: number;
  pages_in_dataset: number;
};

export type CategoryPageRow = {
  page_id: string;
  page_name: string | null;
  /** Meta's labels for this page. Not the research category. */
  page_categories: string[] | null;
  observed_ads: number;
  active_ads: number;
  inactive_ads: number;
  unknown_ads: number;
  recently_found: number;
  started_recently: number;
  evergreen_ads: number;
  reused_ads: number;
  max_collation: number | null;
  last_observed_at: string | null;
  /** The category's distinct observed ads — the only honest denominator. */
  share_denominator: number;
  total_count: number;
};

export type CategoryRunRow = {
  collection_run_id: string;
  dataset_id: string;
  dataset_name: string;
  collected_at: string;
  scope_query: string | null;
  scope_country: string | null;
  observed_ads: number;
  observed_pages: number;
  active_ads: number;
  inactive_ads: number;
  unknown_ads: number;
};

export type CategoryActivityPoint = {
  bucket_start: string;
  started_ads: number;
  first_seen_ads: number;
};

export async function listResearchCategories(): Promise<CategoryListRow[]> {
  const supabase = await dbUser();
  const { data, error } = await supabase.rpc("category_list");
  if (error) throw error;
  return (data ?? []) as CategoryListRow[];
}

export async function getCategoryDetail(
  categoryId: string,
  recentDays = 30,
): Promise<CategoryDetailRow | null> {
  const supabase = await dbUser();
  const { data, error } = await supabase.rpc("category_detail", {
    p_category_id: categoryId, p_recent_days: recentDays,
  });
  if (error) throw error;
  return (data as CategoryDetailRow[])[0] ?? null;
}

export async function getCategoryDatasets(categoryId: string): Promise<CategoryDatasetRow[]> {
  const supabase = await dbUser();
  const { data, error } = await supabase.rpc("category_datasets", { p_category_id: categoryId });
  if (error) throw error;
  return (data ?? []) as CategoryDatasetRow[];
}

export type CategoryPagesOptions = {
  recentDays?: number;
  search?: string | null;
  sort?: string;
  limit?: number;
  offset?: number;
};

export async function getCategoryPages(
  categoryId: string,
  options: CategoryPagesOptions = {},
): Promise<{ rows: CategoryPageRow[]; total: number; denominator: number }> {
  const supabase = await dbUser();
  const { data, error } = await supabase.rpc("category_pages", {
    p_category_id: categoryId,
    p_recent_days: options.recentDays ?? 30,
    p_search: options.search ?? null,
    p_sort: options.sort ?? "observed_ads",
    p_limit: options.limit ?? 25,
    p_offset: options.offset ?? 0,
  });
  if (error) throw error;
  const rows = (data ?? []) as CategoryPageRow[];
  return {
    rows,
    total: rows[0] ? Number(rows[0].total_count) : 0,
    denominator: rows[0] ? Number(rows[0].share_denominator) : 0,
  };
}

export async function getCategoryCreativeMix(categoryId: string): Promise<CreativeMixRow[]> {
  const supabase = await dbUser();
  const { data, error } = await supabase.rpc("category_creative_mix", {
    p_category_id: categoryId,
  });
  if (error) throw error;
  return (data ?? []) as CreativeMixRow[];
}

export async function getCategoryActivity(
  categoryId: string,
  options: { bucket?: "day" | "week"; from?: string | null; to?: string | null } = {},
): Promise<CategoryActivityPoint[]> {
  const supabase = await dbUser();
  const { data, error } = await supabase.rpc("category_activity", {
    p_category_id: categoryId,
    p_bucket: options.bucket ?? "week",
    p_from: options.from ?? null,
    p_to: options.to ?? null,
  });
  if (error) throw error;
  return (data ?? []) as CategoryActivityPoint[];
}

export async function getCategoryRunHistory(categoryId: string): Promise<CategoryRunRow[]> {
  const supabase = await dbUser();
  const { data, error } = await supabase.rpc("category_run_history", {
    p_category_id: categoryId,
  });
  if (error) throw error;
  return (data ?? []) as CategoryRunRow[];
}

export type CategoryEvidenceOptions = {
  signal?: PageSignal | null;
  recentDays?: number;
  format?: string | null;
  cta?: string | null;
  platform?: string | null;
  pageId?: string | null;
  /** A timeline bucket: which clock the window applies to, and the window. */
  windowMetric?: "started" | "first_seen" | null;
  from?: string | null;
  to?: string | null;
  sort?: string;
  limit?: number;
  offset?: number;
};

export async function getCategoryEvidence(
  categoryId: string,
  options: CategoryEvidenceOptions = {},
): Promise<{ rows: PageAdRow[]; total: number }> {
  const supabase = await dbUser();
  const { data, error } = await supabase.rpc("category_evidence", {
    p_category_id: categoryId,
    p_signal: options.signal ?? null,
    p_recent_days: options.recentDays ?? 30,
    p_format: options.format ?? null,
    p_cta: options.cta ?? null,
    p_platform: options.platform ?? null,
    p_page_id: options.pageId ?? null,
    p_window_metric: options.windowMetric ?? null,
    p_from: options.from ?? null,
    p_to: options.to ?? null,
    p_sort: options.sort ?? "started_desc",
    p_limit: options.limit ?? 24,
    p_offset: options.offset ?? 0,
  });
  if (error) throw error;
  const rows = (data ?? []) as PageAdRow[];
  return { rows, total: rows[0] ? Number(rows[0].total_count) : 0 };
}
