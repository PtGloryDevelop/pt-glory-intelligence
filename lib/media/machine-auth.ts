import "server-only";
import { timingSafeEqual } from "node:crypto";

/**
 * Machine authentication for the scheduled drain.
 *
 * Deliberately separate from the user session model. A cron job is not a person,
 * and reusing an analyst cookie as machine credentials would mean the scheduler
 * either holds a user's session or the endpoint accepts anonymous callers —
 * both worse than a dedicated shared secret.
 *
 * The secret is read from the server environment only. It has no NEXT_PUBLIC_
 * prefix, so Next cannot inline it into a client bundle even by accident, and
 * tests assert its absence there.
 */

export type MachineAuthResult = "ok" | "unauthorized" | "not_configured";

/**
 * Constant-time comparison.
 *
 * `===` on secrets leaks their prefix through timing. Lengths are compared
 * first because timingSafeEqual throws on a mismatch — that length check is a
 * genuine (and unavoidable) leak of the secret's length, which is not useful to
 * an attacker in the way a prefix oracle would be.
 */
function secretsMatch(provided: string, expected: string): boolean {
  const a = Buffer.from(provided, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function authenticateMachine(header: string | null): MachineAuthResult {
  const expected = process.env.MEDIA_ARCHIVE_TOKEN;
  // An unset secret must never mean "let everyone in".
  if (!expected || expected.length < 16) return "not_configured";

  const prefix = "Bearer ";
  if (!header || !header.startsWith(prefix)) return "unauthorized";

  return secretsMatch(header.slice(prefix.length).trim(), expected) ? "ok" : "unauthorized";
}
