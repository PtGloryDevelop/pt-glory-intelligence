import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { ArchiveStore } from "./store.ts";

/**
 * Supabase Storage behind the ArchiveStore boundary.
 *
 * Private bucket, service-role client, server only. `server-only` is the import
 * guard: this module holds a credential that must never be reachable from a
 * client component, and the build fails loudly rather than shipping it.
 *
 * There is no public URL anywhere in here on purpose. A permanent public object
 * URL would hand anyone who guessed a path the creative from a dataset they are
 * not allowed to read.
 */

export const PREVIEW_BUCKET = "pt-glory-media-previews";
const DEFAULT_TTL_SECONDS = 60 * 60;

function serviceClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) throw new Error("Supabase storage credentials are not configured");
  return createClient(url, key, { auth: { persistSession: false } });
}

export function supabaseArchiveStore(): ArchiveStore {
  const client = serviceClient();

  return {
    async putPreview(path, bytes, mimeType) {
      const { error } = await client.storage.from(PREVIEW_BUCKET).upload(path, bytes, {
        contentType: mimeType,
        // Same path, same bytes: a rerun after a crash must be a no-op, not a
        // duplicate object or a hard error.
        upsert: true,
      });
      if (error) throw error;
    },

    async getPresentationUrls(paths, expiresInSeconds = DEFAULT_TTL_SECONDS) {
      const signed = new Map<string, string>();
      if (paths.length === 0) return signed;
      const { data, error } = await client.storage
        .from(PREVIEW_BUCKET)
        .createSignedUrls(paths, expiresInSeconds);
      if (error || !data) return signed;
      for (const entry of data) {
        if (entry.path && entry.signedUrl) signed.set(entry.path, entry.signedUrl);
      }
      return signed;
    },

    async getPresentationUrl(path, expiresInSeconds = DEFAULT_TTL_SECONDS) {
      const { data, error } = await client.storage
        .from(PREVIEW_BUCKET)
        .createSignedUrl(path, expiresInSeconds);
      if (error) return null;
      return data?.signedUrl ?? null;
    },
  };
}

/**
 * Creates the private bucket if it is absent. Idempotent, and safe to call at
 * the start of an archival run rather than as a manual deployment step.
 */
export async function ensurePreviewBucket(): Promise<void> {
  const client = serviceClient();
  const { data } = await client.storage.getBucket(PREVIEW_BUCKET);
  if (data) return;
  const { error } = await client.storage.createBucket(PREVIEW_BUCKET, {
    public: false,
    fileSizeLimit: 8 * 1024 * 1024,
    allowedMimeTypes: ["image/jpeg", "image/png", "image/webp"],
  });
  // A parallel run may have created it between the check and the call.
  if (error && !/already exists/i.test(error.message)) throw error;
}
