import "server-only";
import { timingSafeEqual } from "node:crypto";

/** Authentication for the database-driven collection scheduler. */
export type CollectionAdvanceAuth = "ok" | "unauthorized" | "not_configured";

function sameSecret(provided: string, expected: string): boolean {
  const a = Buffer.from(provided, "utf8");
  const b = Buffer.from(expected, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * The scheduler has its own credential, separate from the media archive job.
 * It is read only from the server environment and compared without a prefix
 * oracle. An unset or weak secret fails closed.
 */
export function authenticateCollectionAdvance(header: string | null): CollectionAdvanceAuth {
  const expected = process.env.COLLECTION_ADVANCE_TOKEN;
  if (!expected || expected.length < 16) return "not_configured";

  const prefix = "Bearer ";
  if (!header || !header.startsWith(prefix)) return "unauthorized";
  return sameSecret(header.slice(prefix.length).trim(), expected) ? "ok" : "unauthorized";
}
