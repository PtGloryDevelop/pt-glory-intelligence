import { dbUser } from "../db/user.ts";
import { scopeArgs, type PageScope } from "../pages/scope.ts";
import type { BrandStatus, UnmappedSort } from "../brands/contract.ts";

/**
 * Brand mapping read and write side.
 *
 * Everything goes through the user's own client, so the RLS on `brands` and
 * `brand_page_mappings` is the boundary — a viewer's write is refused by the
 * database, not by a check in this file. The two mutations that must be atomic
 * (map, which is also move, and unmap) are RPCs so the close and the open cannot
 * come apart.
 */

export type BrandListRow = {
  id: string;
  name: string;
  status: BrandStatus;
  notes: string | null;
  active_pages: number;
  mapped_pages_ever: number;
  last_mapping_change: string | null;
  created_at: string;
  total_count: number;
};

export type BrandDetailRow = {
  id: string;
  name: string;
  status: BrandStatus;
  notes: string | null;
  created_at: string;
  updated_at: string;
  active_pages: number;
  pages_in_scope: number;
  observed_ads: number;
  first_observed_at: string | null;
  last_observed_at: string | null;
};

export type BrandPageRow = {
  page_id: string;
  page_name: string | null;
  page_categories: string[] | null;
  observed_ads: number;
  first_observed_at: string | null;
  last_observed_at: string | null;
  mapping_id: string;
  mapped_since: string;
  mapped_by_label: string | null;
  note: string | null;
};

export type MappingHistoryRow = {
  mapping_id: string;
  brand_id: string;
  brand_name: string;
  page_id: string;
  page_name: string | null;
  valid_from: string;
  valid_to: string | null;
  is_current: boolean;
  mapped_by_label: string | null;
  ended_by_label: string | null;
  note: string | null;
};

export type UnmappedPageRow = {
  page_id: string;
  page_name: string | null;
  page_categories: string[] | null;
  observed_ads: number;
  recently_found: number;
  first_observed_at: string | null;
  last_observed_at: string | null;
  total_count: number;
};

export type PageBrandRow = {
  brand_id: string;
  brand_name: string;
  brand_status: BrandStatus;
  mapped_since: string;
  mapped_by_label: string | null;
  note: string | null;
};

export async function listBrands(options: {
  search?: string | null;
  status?: BrandStatus | "all";
  limit?: number;
  offset?: number;
} = {}): Promise<{ rows: BrandListRow[]; total: number }> {
  const supabase = await dbUser();
  const { data, error } = await supabase.rpc("brand_list", {
    p_search: options.search ?? null,
    p_status: options.status ?? "active",
    p_limit: options.limit ?? 30,
    p_offset: options.offset ?? 0,
  });
  if (error) throw error;
  const rows = (data ?? []) as BrandListRow[];
  return { rows, total: rows[0] ? Number(rows[0].total_count) : 0 };
}

export async function getBrandDetail(
  id: string, scope: PageScope,
): Promise<BrandDetailRow | null> {
  const supabase = await dbUser();
  const { p_scope, p_scope_id } = scopeArgs(scope);
  const { data, error } = await supabase.rpc("brand_detail", {
    p_brand_id: id, p_scope, p_scope_id,
  });
  if (error) throw error;
  return ((data ?? []) as BrandDetailRow[])[0] ?? null;
}

export async function getBrandPages(id: string, scope: PageScope): Promise<BrandPageRow[]> {
  const supabase = await dbUser();
  const { p_scope, p_scope_id } = scopeArgs(scope);
  const { data, error } = await supabase.rpc("brand_pages", {
    p_brand_id: id, p_scope, p_scope_id,
  });
  if (error) throw error;
  return (data ?? []) as BrandPageRow[];
}

export async function getMappingHistory(
  filter: { brandId?: string | null; pageId?: string | null },
): Promise<MappingHistoryRow[]> {
  const supabase = await dbUser();
  const { data, error } = await supabase.rpc("brand_mapping_history", {
    p_brand_id: filter.brandId ?? null,
    p_page_id: filter.pageId ?? null,
    p_limit: 100,
  });
  if (error) throw error;
  return (data ?? []) as MappingHistoryRow[];
}

export async function listUnmappedPages(options: {
  scope: PageScope;
  search?: string | null;
  sort?: UnmappedSort;
  limit?: number;
  offset?: number;
}): Promise<{ rows: UnmappedPageRow[]; total: number }> {
  const supabase = await dbUser();
  const { p_scope, p_scope_id } = scopeArgs(options.scope);
  const { data, error } = await supabase.rpc("unmapped_pages", {
    p_scope, p_scope_id,
    p_search: options.search ?? null,
    p_sort: options.sort ?? "observed_ads",
    p_limit: options.limit ?? 30,
    p_offset: options.offset ?? 0,
  });
  if (error) throw error;
  const rows = (data ?? []) as UnmappedPageRow[];
  return { rows, total: rows[0] ? Number(rows[0].total_count) : 0 };
}

/** The Brand a Page is grouped into right now, or null while it is unmapped. */
export async function getPageBrand(pageId: string): Promise<PageBrandRow | null> {
  const supabase = await dbUser();
  const { data, error } = await supabase.rpc("page_brand", { p_page_id: pageId });
  if (error) throw error;
  return ((data ?? []) as PageBrandRow[])[0] ?? null;
}

/* ------------------------------------------------------------------ writes */

export type WriteResult<T> =
  | { ok: true; value: T }
  | { ok: false; status: number; message: string; duplicates?: BrandListRow[] };

/** PostgREST surfaces the RLS refusal and our own role check as these codes. */
function denied(error: { code?: string }): boolean {
  return error.code === "42501";
}

export async function createBrand(input: {
  name: string; notes: string | null; actorId: string;
}): Promise<WriteResult<{ id: string }>> {
  const supabase = await dbUser();
  const { data, error } = await supabase
    .from("brands")
    .insert({ name: input.name, notes: input.notes, created_by: input.actorId })
    .select("id")
    .single();

  if (error) {
    if (denied(error)) return { ok: false, status: 403, message: "ต้องมีสิทธิ์ Analyst ขึ้นไป" };
    if (error.code === "23505") {
      // The normalized name is taken. Hand back what already exists so a person
      // can choose it — nothing is merged, and nothing is renamed for them.
      const existing = await listBrands({ search: input.name, status: "all", limit: 5 });
      return {
        ok: false, status: 409, message: "มีแบรนด์ชื่อนี้อยู่แล้ว", duplicates: existing.rows,
      };
    }
    return { ok: false, status: 400, message: "สร้างแบรนด์ไม่สำเร็จ" };
  }
  return { ok: true, value: { id: (data as { id: string }).id } };
}

export async function updateBrand(id: string, patch: {
  name?: string; notes?: string | null; status?: BrandStatus;
}): Promise<WriteResult<{ id: string }>> {
  const supabase = await dbUser();
  const { data, error } = await supabase
    .from("brands")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select("id");

  if (error) {
    if (denied(error)) return { ok: false, status: 403, message: "ต้องมีสิทธิ์ Analyst ขึ้นไป" };
    if (error.code === "23505") {
      const existing = await listBrands({ search: patch.name ?? "", status: "all", limit: 5 });
      return {
        ok: false, status: 409, message: "มีแบรนด์ชื่อนี้อยู่แล้ว", duplicates: existing.rows,
      };
    }
    return { ok: false, status: 400, message: "แก้ไขแบรนด์ไม่สำเร็จ" };
  }
  // RLS turns "not allowed" into "no rows" on an update, so an empty result is
  // not necessarily a missing brand. The role check above has already run.
  const rows = (data ?? []) as { id: string }[];
  if (rows.length === 0) return { ok: false, status: 404, message: "ไม่พบแบรนด์นี้" };
  return { ok: true, value: rows[0] };
}

/**
 * Maps a Page, moving it if it already belongs somewhere.
 *
 * One RPC, because a move is a close and an open that must not come apart: two
 * calls would leave an instant with no mapping, or — worse — with two.
 */
export async function mapPageToBrand(input: {
  brandId: string; pageId: string; note: string | null; actorLabel: string | null;
}): Promise<WriteResult<{ mappingId: string }>> {
  const supabase = await dbUser();
  const { data, error } = await supabase.rpc("brand_map_page", {
    p_brand_id: input.brandId,
    p_page_id: input.pageId,
    p_note: input.note,
    p_actor_label: input.actorLabel,
  });
  if (error) {
    if (denied(error)) return { ok: false, status: 403, message: "ต้องมีสิทธิ์ Analyst ขึ้นไป" };
    if (error.code === "23514") {
      return { ok: false, status: 409, message: "แบรนด์นี้ถูกเก็บเข้าคลังแล้ว จับคู่เพจใหม่ไม่ได้" };
    }
    if (error.code === "23503") return { ok: false, status: 404, message: "ไม่พบแบรนด์หรือเพจนี้" };
    return { ok: false, status: 400, message: "จับคู่ไม่สำเร็จ" };
  }
  return { ok: true, value: { mappingId: data as string } };
}

export async function unmapPage(input: {
  pageId: string; actorLabel: string | null;
}): Promise<WriteResult<{ changed: boolean }>> {
  const supabase = await dbUser();
  const { data, error } = await supabase.rpc("brand_unmap_page", {
    p_page_id: input.pageId, p_actor_label: input.actorLabel,
  });
  if (error) {
    if (denied(error)) return { ok: false, status: 403, message: "ต้องมีสิทธิ์ Analyst ขึ้นไป" };
    return { ok: false, status: 400, message: "เลิกจับคู่ไม่สำเร็จ" };
  }
  return { ok: true, value: { changed: data === true } };
}

/**
 * The label stored with an editorial decision.
 *
 * A snapshot of who did it, taken at the time: `auth.users` is not readable
 * from the app's role, so a uuid alone would render as nothing a person could
 * recognise — and would keep rendering as nothing after the account is gone.
 */
export async function actorLabel(): Promise<string | null> {
  const supabase = await dbUser();
  const { data } = await supabase.auth.getUser();
  return data.user?.email ?? null;
}
