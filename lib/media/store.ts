/**
 * Where archived previews live, behind a boundary.
 *
 * Nothing in the media domain should know what Supabase Storage is. The domain
 * asks for "put these bytes at this path" and "give me something the browser can
 * render"; swapping the provider later is then a file, not a refactor.
 *
 * The durable thing is the OBJECT. A delivery URL from a private bucket is
 * short-lived by design and is never persisted as canonical data — only
 * `storage_path` is.
 */

export type ArchiveStore = {
  /** Overwrites at the same path on purpose: reruns must converge, not duplicate. */
  putPreview(path: string, bytes: Buffer, mimeType: string): Promise<void>;
  /** A time-limited URL for one render. Regenerated on every read. */
  getPresentationUrl(path: string, expiresInSeconds?: number): Promise<string | null>;
  /** Same, for a page of rows — one round trip instead of thirty. */
  getPresentationUrls(paths: string[], expiresInSeconds?: number): Promise<Map<string, string>>;
};

/**
 * Deterministic, observation-scoped object key.
 *
 * Scoped by collection run and observation id — never by ad_archive_id. Keying
 * by the ad would let a newer run overwrite the creative an older dataset shows,
 * which is invariant I1 broken through the storage layer.
 *
 * Determinism is also what makes the processor recoverable: if an upload
 * succeeds and the process dies before the status is written, the rerun writes
 * the same bytes to the same key and converges.
 */
export function previewPath(
  collectionRunId: string,
  adObservationId: string,
  mimeType: string,
): string {
  const extension =
    mimeType === "image/png" ? "png" : mimeType === "image/webp" ? "webp" : "jpg";
  return `previews/${collectionRunId}/${adObservationId}/preview.${extension}`;
}
