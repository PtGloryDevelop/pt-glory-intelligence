import { dbUser } from "../db/user.ts";
import {
  COLLECTION_VIEW_COLUMNS, toCollectionDto, type CollectionDto, type CollectionRequestRow,
} from "./dto.ts";

/**
 * The normal read path for collections (C13).
 *
 * Two boundaries, both deliberate. It reads through the caller's own client, so
 * the database's own select-own policy decides which rows come back — a bug in
 * this file cannot hand somebody another person's collection. And it reads the
 * user-safe view by an explicit column list, so a provider identifier, an error
 * class or a cost can never arrive to be forgotten about later.
 */

const COLUMNS = COLLECTION_VIEW_COLUMNS.join(", ");

/** The caller's own collections, newest first. */
export async function listCollections(limit = 50): Promise<CollectionDto[]> {
  const supabase = await dbUser();
  const { data, error } = await supabase
    .from("collection_request_status")
    .select(COLUMNS)
    .order("created_at", { ascending: false })
    .limit(Math.min(Math.max(limit, 1), 200));
  if (error) throw error;
  return (data as unknown as CollectionRequestRow[]).map(toCollectionDto);
}

/** One collection, or null when the caller may not see it — which is the same answer. */
export async function readCollection(id: string): Promise<CollectionDto | null> {
  const supabase = await dbUser();
  const { data, error } = await supabase
    .from("collection_request_status")
    .select(COLUMNS)
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return data ? toCollectionDto(data as unknown as CollectionRequestRow) : null;
}
