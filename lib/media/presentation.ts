import "server-only";
import { supabaseArchiveStore } from "./store-supabase.ts";

/**
 * Mints delivery URLs for a page of archived previews, in one round trip.
 *
 * Kept apart from the resolver so the pure decision logic stays testable without
 * a storage provider, and so components never hold a storage client. The URLs
 * are short-lived on purpose: the durable thing is the object, not the link.
 */
export async function signArchivedPreviews(
  rows: { archive_path: string | null; archive_status: string | null }[],
): Promise<Map<string, string>> {
  const paths = [...new Set(
    rows.filter((row) => row.archive_status === "archived" && row.archive_path)
      .map((row) => row.archive_path as string),
  )];
  if (paths.length === 0) return new Map();
  try {
    return await supabaseArchiveStore().getPresentationUrls(paths);
  } catch {
    // A storage hiccup must not take the page down: the resolver falls back to
    // the source URL, and a dataset imported recently still renders.
    return new Map();
  }
}
