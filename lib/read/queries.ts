import { dbUser } from "../db/user.ts";

/**
 * Read side. Every query goes through the user's Supabase client, so RLS is the
 * boundary here — the privileged connection never touches a read path.
 *
 * The SQL lives in migration 0018 rather than in TypeScript so that snapshot
 * pinning has exactly one definition, shared by these routes and the
 * integration tests.
 */

export type DatasetContext = {
  dataset_id: string; dataset_name: string; category_name: string;
  collection_run_id: string; collection_method: string; source_product: string;
  scope_query: string | null; scope_country: string | null; collected_at: string;
  run_status: string; computed_unique_ads: number; computed_unique_pages: number;
  computed_source_rows: number; computed_unresolved_count: number;
  quarantine_count: number; ads_in_dataset: number;
  /** Dataset membership truth. computed_unique_pages above is run provenance. */
  pages_in_dataset: number;
};

/** Dataset list projection — migration 0020, handoff §7.3. */
export type DatasetListRow = {
  dataset_id: string; dataset_name: string; created_at: string;
  category_id: string; category_name: string;
  collection_run_id: string; collection_method: string; source_product: string;
  scope_query: string | null; scope_country: string | null; collected_at: string;
  run_status: string; ads_in_dataset: number; pages_in_dataset: number;
  quality_tier: "normal" | "partial" | "low" | "unknown";
};

export type QualityRow = {
  field: string; present_count: number; total_count: number;
  coverage: number; tier: "normal" | "partial" | "low";
};

export type ExplorerRow = {
  ad_archive_id: string; is_active: boolean | null; display_format: string | null;
  publisher_platform: string[]; cta_type: string | null; cta_text: string | null;
  title: string | null; body_text: string | null; page_id: string;
  page_name: string | null; page_categories: string[] | null;
  start_date: string; collation_count: number | null; total_count: number;
};

export type Facet = { facet: string; value: string; n: number };

export type AdDetail = {
  context: "dataset" | "master";
  ad_archive_id: string; page_id: string; page_profile_uri: string | null;
  page_profile_numeric_id: string | null; page_name: string | null;
  page_like_count: number | null; page_categories: string[] | null;
  start_date: string; end_date: string | null; first_seen_at: string;
  last_seen_at: string; ad_age_days: number; is_active: boolean | null;
  display_format: string | null; publisher_platform: string[] | null;
  cta_type: string | null; cta_text: string | null; title: string | null;
  body_text: string | null; caption: string | null; link_url: string | null;
  link_description: string | null; collation_count: number | null;
  media: { images?: unknown[]; videos?: unknown[]; cards?: unknown[] } | null;
  observed_at: string | null; collection_run_id: string | null;
};

export type ObservationHistoryRow = {
  observed_at: string; collection_run_id: string; collection_method: string;
  is_active: boolean | null; display_format: string | null;
  publisher_platform: string[] | null; cta_type: string | null;
  collation_count: number | null;
};

export type ExplorerFilters = {
  active?: string | null; format?: string | null; cta?: string | null;
  platform?: string | null; category?: string | null; search?: string | null;
  limit?: number; offset?: number;
};

export async function getDatasetContext(datasetId: string): Promise<DatasetContext | null> {
  const supabase = await dbUser();
  const { data, error } = await supabase.rpc("dataset_context", { p_dataset_id: datasetId });
  if (error) throw error;
  return (data as DatasetContext[])[0] ?? null;
}

export async function getDatasetQuality(datasetId: string): Promise<QualityRow[]> {
  const supabase = await dbUser();
  const { data, error } = await supabase
    .from("dataset_quality")
    .select("field, present_count, total_count, coverage, tier")
    .eq("dataset_id", datasetId)
    .order("field");
  if (error) throw error;
  return (data ?? []) as QualityRow[];
}

export async function getDatasetAds(
  datasetId: string,
  filters: ExplorerFilters = {},
): Promise<{ rows: ExplorerRow[]; total: number }> {
  const supabase = await dbUser();
  const { data, error } = await supabase.rpc("dataset_ads_page", {
    p_dataset_id: datasetId,
    p_active: filters.active ?? null,
    p_format: filters.format ?? null,
    p_cta: filters.cta ?? null,
    p_platform: filters.platform ?? null,
    p_category: filters.category ?? null,
    p_search: filters.search ?? null,
    p_limit: filters.limit ?? 30,
    p_offset: filters.offset ?? 0,
  });
  if (error) throw error;
  const rows = (data ?? []) as ExplorerRow[];
  // An empty page still needs a denominator; zero rows means zero matches.
  return { rows, total: rows[0] ? Number(rows[0].total_count) : 0 };
}

export async function getDatasetFacets(datasetId: string): Promise<Facet[]> {
  const supabase = await dbUser();
  const { data, error } = await supabase.rpc("dataset_ads_facets", { p_dataset_id: datasetId });
  if (error) throw error;
  return (data ?? []) as Facet[];
}

export async function getAdDetail(
  adArchiveId: string,
  datasetId: string | null,
): Promise<AdDetail | null> {
  const supabase = await dbUser();
  const { data, error } = await supabase.rpc("ad_detail", {
    p_ad_archive_id: adArchiveId,
    p_dataset_id: datasetId,
  });
  if (error) throw error;
  // No row in dataset context means the ad is not a member. The caller answers
  // 404; it must never retry without the dataset and show latest state instead.
  return (data as AdDetail[])[0] ?? null;
}

export async function getObservationHistory(adArchiveId: string): Promise<ObservationHistoryRow[]> {
  const supabase = await dbUser();
  const { data, error } = await supabase.rpc("ad_observation_history", {
    p_ad_archive_id: adArchiveId,
  });
  if (error) throw error;
  return (data ?? []) as ObservationHistoryRow[];
}

export async function listCategories(): Promise<{ id: string; name: string }[]> {
  const supabase = await dbUser();
  const { data, error } = await supabase.from("categories").select("id, name").order("name");
  if (error) throw error;
  return (data ?? []) as { id: string; name: string }[];
}

export async function listDatasets(): Promise<DatasetListRow[]> {
  const supabase = await dbUser();
  const { data, error } = await supabase.rpc("dataset_list");
  if (error) throw error;
  return (data ?? []) as DatasetListRow[];
}
