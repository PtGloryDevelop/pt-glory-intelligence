import { dbUser } from "../db/user.ts";
import type { PageAdRow } from "./pages.ts";
import type { WatchScope, WatchSignal, WatchTargetType } from "../watchlist/contract.ts";
import { scopeColumns } from "../watchlist/contract.ts";

/**
 * Watchlist read and write side.
 *
 * Everything here goes through the user's own client, reads and writes alike, so
 * `watch_items` RLS is the boundary rather than an application check. A watch is
 * personal state; the database is what makes it personal.
 */

export type WatchListRow = {
  id: string;
  target_type: WatchTargetType;
  target_page_id: string | null;
  target_category_id: string | null;
  target_name: string;
  scope_kind: "dataset" | "category" | "all";
  scope_dataset_id: string | null;
  scope_category_id: string | null;
  scope_name: string | null;
  /** False when the dataset or category behind the scope was soft-deleted. */
  scope_available: boolean;
  tracked_signals: WatchSignal[];
  baseline_at: string;
  created_at: string;
  latest_collected_at: string | null;
};

export type WatchSignalRow = {
  signal: WatchSignal;
  kind: "event" | "state" | "first_observed";
  /** Exactly what the evidence query returns for this signal. */
  value: number;
  /** The values first seen after the baseline, for first_observed signals. */
  new_values: string[] | null;
  /** Ads re-observed since the baseline. Zero means we have not collected. */
  new_observations: number;
  baseline_at: string;
};

export async function listWatchItems(): Promise<WatchListRow[]> {
  const supabase = await dbUser();
  const { data, error } = await supabase.rpc("watchlist_list");
  if (error) throw error;
  return (data ?? []) as WatchListRow[];
}

/** One watch, or null when it is not this user's — RLS decides, not us. */
export async function getWatchItem(id: string): Promise<WatchListRow | null> {
  const rows = await listWatchItems();
  return rows.find((row) => row.id === id) ?? null;
}

export async function getWatchSignals(id: string): Promise<WatchSignalRow[]> {
  const supabase = await dbUser();
  const { data, error } = await supabase.rpc("watchlist_signal_summary", { p_watch_id: id });
  if (error) throw error;
  return (data ?? []) as WatchSignalRow[];
}

export async function getWatchEvidence(
  id: string,
  signal: WatchSignal,
  options: { limit?: number; offset?: number } = {},
): Promise<{ rows: PageAdRow[]; total: number }> {
  const supabase = await dbUser();
  const { data, error } = await supabase.rpc("watchlist_signal_evidence", {
    p_watch_id: id, p_signal: signal,
    p_limit: options.limit ?? 24, p_offset: options.offset ?? 0,
  });
  if (error) throw error;
  const rows = (data ?? []) as PageAdRow[];
  return { rows, total: rows[0] ? Number(rows[0].total_count) : 0 };
}

/* ------------------------------------------------------------------ writes */

export type CreateWatchInput = {
  actorId: string;
  targetType: WatchTargetType;
  targetPageId?: string | null;
  targetCategoryId?: string | null;
  scope: WatchScope;
  signals: WatchSignal[];
};

/**
 * Saves a watch as the signed-in user.
 *
 * `created_by` is written explicitly and checked by RLS against `auth.uid()`,
 * so a forged owner is rejected by the database rather than trusted from here.
 * `baseline_at` is left to the column default — server time, never the browser's.
 */
export async function createWatchItem(input: CreateWatchInput): Promise<
  { ok: true; id: string } | { ok: false; duplicate: boolean; message: string }
> {
  const supabase = await dbUser();
  const { data, error } = await supabase
    .from("watch_items")
    .insert({
      created_by: input.actorId,
      target_type: input.targetType,
      target_page_id: input.targetPageId ?? null,
      target_category_id: input.targetCategoryId ?? null,
      ...scopeColumns(input.scope),
      tracked_signals: input.signals,
    })
    .select("id")
    .single();

  if (error) {
    // 23505 is the (owner, target, scope) unique index: the same watch already
    // exists, which is an answer rather than a failure.
    const duplicate = error.code === "23505";
    return {
      ok: false,
      duplicate,
      message: duplicate ? "watch already exists" : "could not save watch",
    };
  }
  return { ok: true, id: (data as { id: string }).id };
}

export async function updateWatchSignals(id: string, signals: WatchSignal[]): Promise<boolean> {
  const supabase = await dbUser();
  // Deliberately does not touch baseline_at: changing what you track is not the
  // same as saying "I have seen everything up to now".
  const { data, error } = await supabase
    .from("watch_items")
    .update({ tracked_signals: signals, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select("id");
  if (error) throw error;
  return (data ?? []).length > 0;
}

/**
 * Moves the baseline to now — the one mutation that changes what "since" means.
 *
 * The timestamp comes from the database, not the caller: a browser clock must
 * never decide what counts as new, and a supplied value could be backdated to
 * make old ads look fresh.
 */
export async function resetWatchBaseline(id: string): Promise<boolean> {
  const supabase = await dbUser();
  const { data, error } = await supabase.rpc("watchlist_reset_baseline", { p_watch_id: id });
  if (error) throw error;
  return data === true;
}

export async function deleteWatchItem(id: string): Promise<boolean> {
  const supabase = await dbUser();
  const { data, error } = await supabase
    .from("watch_items").delete().eq("id", id).select("id");
  if (error) throw error;
  return (data ?? []).length > 0;
}
