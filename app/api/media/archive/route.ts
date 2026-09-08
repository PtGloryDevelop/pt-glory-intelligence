import { NextResponse, type NextRequest } from "next/server";
import { requireRole } from "@/lib/auth/roles";
import { AuthorizationError } from "@/lib/auth/role-model";
import { drainArchiveQueue } from "@/lib/media/archive";
import { archiveHealth } from "@/lib/media/health";
import { ensurePreviewBucket, supabaseArchiveStore } from "@/lib/media/store-supabase";
import { isUuid } from "@/lib/read/request";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * Maintenance drain and queue health, for a human.
 *
 * Since C1.8 the production guarantee is the pg_cron schedule, not this. This
 * stays for manual recovery, local development, and answering "is the queue
 * moving?" without a database client.
 *
 * Bounded, explicitly invoked drain of the preview archive queue.
 *
 * The queue itself lives in the database, so nothing here is the durability
 * mechanism — this is one way to turn the crank. Whatever this call does not
 * reach stays committed as pending and the next invocation picks it up, which is
 * what makes it safe to run repeatedly, concurrently, or after a crash.
 *
 * Analyst or above: archival spends bandwidth and writes to storage.
 */
export async function POST(request: NextRequest) {
  try {
    await requireRole("analyst");
  } catch (error) {
    if (error instanceof AuthorizationError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }

  const query = request.nextUrl.searchParams;
  const runId = query.get("collectionRunId");
  if (runId !== null && !isUuid(runId)) {
    return NextResponse.json({ error: "collectionRunId must be a UUID" }, { status: 400 });
  }
  const limit = Math.min(Math.max(Number(query.get("limit") ?? 100) || 100, 1), 500);

  try {
    await ensurePreviewBucket();
    const stats = await drainArchiveQueue(supabaseArchiveStore(), {
      limit,
      collectionRunId: runId ?? undefined,
    });
    return NextResponse.json(stats);
  } catch (error) {
    // Never surface a raw storage or database error: they carry endpoints.
    console.error("archive drain failed", error);
    return NextResponse.json({ error: "archive drain failed" }, { status: 500 });
  }
}

/** Queue health. Analyst or above — it is operational, not public. */
export async function GET() {
  try {
    await requireRole("analyst");
  } catch (error) {
    if (error instanceof AuthorizationError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }

  try {
    return NextResponse.json(await archiveHealth());
  } catch (error) {
    console.error("archive health failed", error);
    return NextResponse.json({ error: "archive health failed" }, { status: 500 });
  }
}
