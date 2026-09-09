import { dbUser } from "../db/user.ts";
import { scopeArgs, type PageScope } from "../pages/scope.ts";
import type { PageAdRow } from "./pages.ts";
import type { MetricKind, RankDirection, TrendMetric } from "../trends/metrics.ts";
import type { Window } from "../trends/periods.ts";

/**
 * Trends read side.
 *
 * Four reads render the surface — summary, page ranking, mix, contributing data
 * — and evidence is loaded only for the metric the reader opened. Nothing is
 * aggregated in the browser, and no trend is cached anywhere.
 */

export type TrendSummaryRow = {
  metric: TrendMetric;
  kind: MetricKind;
  current_value: number;
  previous_value: number;
};

export type TrendPageRow = {
  page_id: string;
  page_name: string | null;
  current_value: number;
  previous_value: number;
  change: number;
  total_count: number;
};

export type TrendMixRow = {
  period: "current" | "previous";
  dimension: "display_format" | "cta_type" | "publisher_platform";
  value: string;
  n: number;
  /** Ads in THIS period's reference view where the field was readable. */
  covered: number;
  observed: number;
  exclusive: boolean;
};

export type TrendContextRow = {
  collection_run_id: string;
  dataset_id: string;
  dataset_name: string;
  collected_at: string;
  scope_query: string | null;
  scope_country: string | null;
  collection_method: string;
};

export async function getTrendSummary(
  scope: PageScope,
  pageId: string | null,
  current: Window,
  previous: Window,
): Promise<TrendSummaryRow[]> {
  const supabase = await dbUser();
  const { data, error } = await supabase.rpc("trend_summary", {
    ...scopeArgs(scope),
    p_page_id: pageId,
    p_current_from: current.from, p_current_to: current.to,
    p_previous_from: previous.from, p_previous_to: previous.to,
  });
  if (error) throw error;
  return (data ?? []) as TrendSummaryRow[];
}

export async function getTrendPages(
  scope: PageScope,
  metric: "first_seen" | "started",
  current: Window,
  previous: Window,
  options: { direction?: RankDirection; limit?: number; offset?: number } = {},
): Promise<{ rows: TrendPageRow[]; total: number }> {
  const supabase = await dbUser();
  const { data, error } = await supabase.rpc("trend_pages", {
    ...scopeArgs(scope),
    p_metric: metric,
    p_current_from: current.from, p_current_to: current.to,
    p_previous_from: previous.from, p_previous_to: previous.to,
    p_direction: options.direction ?? "increase",
    p_limit: options.limit ?? 10,
    p_offset: options.offset ?? 0,
  });
  if (error) throw error;
  const rows = (data ?? []) as TrendPageRow[];
  return { rows, total: rows[0] ? Number(rows[0].total_count) : 0 };
}

/** The creative mix as it stood at each period's end. Coverage per period. */
export async function getTrendMix(
  scope: PageScope,
  pageId: string | null,
  current: Window,
  previous: Window,
): Promise<TrendMixRow[]> {
  const supabase = await dbUser();
  const { data, error } = await supabase.rpc("trend_mix", {
    ...scopeArgs(scope),
    p_page_id: pageId,
    p_current_to: current.to, p_previous_to: previous.to,
  });
  if (error) throw error;
  return (data ?? []) as TrendMixRow[];
}

export async function getTrendContext(
  scope: PageScope,
  window: Window,
): Promise<TrendContextRow[]> {
  const supabase = await dbUser();
  const { data, error } = await supabase.rpc("trend_context", {
    ...scopeArgs(scope), p_from: window.from, p_to: window.to,
  });
  if (error) throw error;
  return (data ?? []) as TrendContextRow[];
}

export type TrendEvidenceOptions = {
  pageId?: string | null;
  /** Set for an event metric: the clock, and the window it applies to. */
  event?: "first_seen" | "started" | null;
  from?: string | null;
  to?: string | null;
  /** Set for a state metric: the instant the scope is reconstructed at. */
  reference?: string | null;
  signal?: string | null;
  format?: string | null;
  cta?: string | null;
  platform?: string | null;
  limit?: number;
  offset?: number;
};

export async function getTrendEvidence(
  scope: PageScope,
  options: TrendEvidenceOptions = {},
): Promise<{ rows: PageAdRow[]; total: number }> {
  const supabase = await dbUser();
  const { data, error } = await supabase.rpc("trend_evidence", {
    ...scopeArgs(scope),
    p_page_id: options.pageId ?? null,
    // An event window and a state reference are never both supplied: they are
    // answers to different questions.
    p_event: options.event ?? null,
    p_from: options.from ?? null,
    p_to: options.to ?? null,
    p_reference: options.reference ?? null,
    p_signal: options.signal ?? null,
    p_format: options.format ?? null,
    p_cta: options.cta ?? null,
    p_platform: options.platform ?? null,
    p_limit: options.limit ?? 24,
    p_offset: options.offset ?? 0,
  });
  if (error) throw error;
  const rows = (data ?? []) as PageAdRow[];
  return { rows, total: rows[0] ? Number(rows[0].total_count) : 0 };
}
