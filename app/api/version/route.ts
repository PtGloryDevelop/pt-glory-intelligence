import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Which build is serving this request.
 *
 * The pilot team reports what they saw; this says what they were looking at. A
 * bug report against "the site" is unactionable once two deploys exist.
 *
 * Deliberately open — no session required. A signed-out operator checking
 * whether a deploy landed should not have to log in first, and the response
 * carries nothing an attacker could not learn by reading the page: a commit id
 * of a private repository, a build timestamp, and the environment label.
 * Nothing here touches the database or names a secret.
 */
export function GET() {
  return NextResponse.json({
    commit: process.env.PT_GLORY_COMMIT ?? "unknown",
    builtAt: process.env.PT_GLORY_BUILT_AT ?? null,
    environment: process.env.PT_GLORY_ENV ?? "unknown",
    // Vercel sets this per deployment; absent when running locally.
    deployment: process.env.VERCEL_URL ? "vercel" : "local",
  });
}
