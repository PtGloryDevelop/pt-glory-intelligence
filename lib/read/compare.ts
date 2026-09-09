import { dbUser } from "../db/user.ts";
import { scopeArgs, type PageScope } from "../pages/scope.ts";
import type { PageDetailRow } from "./pages.ts";
import type { Side } from "../compare/contract.ts";

/**
 * Page compare read side.
 *
 * Three reads for a whole comparison — summary, mix, timeline — each returning
 * both sides. The evidence behind any compared number is read through the
 * frozen page readers instead, once per side, so a count and its ads are always
 * the same definition rather than two that happen to agree.
 */

export type CompareSummaryRow = PageDetailRow & {
  side: Side;
  /** False when the page is not represented in this scope. Never a zero. */
  in_scope: boolean;
};

export type CompareMixRow = {
  side: Side;
  dimension: "display_format" | "cta_type" | "publisher_platform" | "page_category";
  value: string;
  n: number;
  /** Ads on THIS side in which the dimension was readable. Never shared. */
  covered: number;
  /** Ads observed on this side. */
  observed: number;
  exclusive: boolean;
};

export type CompareTimelinePoint = {
  bucket_start: string;
  a_ads: number;
  b_ads: number;
};

export async function getCompareSummary(
  scope: PageScope,
  pageA: string,
  pageB: string,
  recentDays = 30,
): Promise<{ a: CompareSummaryRow | null; b: CompareSummaryRow | null }> {
  const supabase = await dbUser();
  const { data, error } = await supabase.rpc("page_compare_summary", {
    ...scopeArgs(scope),
    p_page_a: pageA, p_page_b: pageB, p_recent_days: recentDays,
  });
  if (error) throw error;
  const rows = (data ?? []) as CompareSummaryRow[];
  // A page the product has never seen returns no row at all; the caller treats
  // that the same as in_scope=false, and says so rather than showing zeroes.
  return {
    a: rows.find((row) => row.side === "a") ?? null,
    b: rows.find((row) => row.side === "b") ?? null,
  };
}

export async function getCompareMix(
  scope: PageScope,
  pageA: string,
  pageB: string,
): Promise<CompareMixRow[]> {
  const supabase = await dbUser();
  const { data, error } = await supabase.rpc("page_compare_mix", {
    ...scopeArgs(scope), p_page_a: pageA, p_page_b: pageB,
  });
  if (error) throw error;
  return (data ?? []) as CompareMixRow[];
}

export async function getCompareTimeline(
  scope: PageScope,
  pageA: string,
  pageB: string,
  options: {
    metric?: "started" | "first_seen";
    bucket?: "day" | "week";
    from?: string | null;
    to?: string | null;
  } = {},
): Promise<CompareTimelinePoint[]> {
  const supabase = await dbUser();
  const { data, error } = await supabase.rpc("page_compare_timeline", {
    ...scopeArgs(scope),
    p_page_a: pageA, p_page_b: pageB,
    // One clock, chosen once and applied to both sides.
    p_metric: options.metric ?? "started",
    p_bucket: options.bucket ?? "week",
    p_from: options.from ?? null,
    p_to: options.to ?? null,
  });
  if (error) throw error;
  return (data ?? []) as CompareTimelinePoint[];
}
