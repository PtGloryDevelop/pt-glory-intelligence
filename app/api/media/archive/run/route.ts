import { NextResponse, type NextRequest } from "next/server";
import { drainArchiveQueue } from "@/lib/media/archive";
import { archiveHealth } from "@/lib/media/health";
import { archivePagePictures } from "@/lib/media/page-pictures";
import { authenticateMachine } from "@/lib/media/machine-auth";
import { ensurePreviewBucket, supabaseArchiveStore } from "@/lib/media/store-supabase";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * The scheduled drain. Called by pg_cron through pg_net every ten minutes.
 *
 * Machine credentials only — no session, no cookie, no user. The same
 * `drainArchiveQueue` the maintenance endpoint uses does the work; there is one
 * implementation of archival and this is another way to invoke it.
 */
export async function POST(request: NextRequest) {
  const auth = authenticateMachine(request.headers.get("authorization"));
  if (auth !== "ok") {
    // Identical response either way: a caller learns whether they guessed the
    // secret, not whether the deployment has one configured.
    if (auth === "not_configured") console.error("MEDIA_ARCHIVE_TOKEN is not configured");
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let limit = 200;
  try {
    const body = await request.json();
    const requested = Number(body?.limit);
    if (Number.isFinite(requested)) limit = Math.min(Math.max(Math.trunc(requested), 1), 500);
  } catch {
    // No body, or not JSON. The default is the point of having one.
  }

  try {
    await ensurePreviewBucket();
    const stats = await drainArchiveQueue(supabaseArchiveStore(), { limit });
    const pictures = await archivePagePictures(supabaseArchiveStore(), 50);
    const health = await archiveHealth();
    // Logged so a scheduler run leaves a trace even though pg_net discards the
    // response body.
    console.info("media archive drain", { ...stats, pending: health.pending, pictures });
    return NextResponse.json({ stats, health });
  } catch (error) {
    console.error("scheduled archive drain failed", error);
    return NextResponse.json({ error: "archive drain failed" }, { status: 500 });
  }
}
