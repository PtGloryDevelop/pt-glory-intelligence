import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { deleteWatchItem, getWatchItem, updateWatchSignals } from "@/lib/read/watchlist";
import { badRequest, notFound, readRoute } from "@/lib/read/guard";
import { getActor } from "@/lib/auth/roles";
import { normalizeSignals } from "@/lib/watchlist/contract";
import { isUuid } from "@/lib/read/request";

export const runtime = "nodejs";

/**
 * Edit the tracked signals.
 *
 * Deliberately does not touch the baseline: deciding to track one more thing is
 * not the same as saying you have seen everything up to now.
 */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return readRoute(async () => {
    const actor = await getActor();
    if (!actor) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
    if (!isUuid(id)) return badRequest("watch id must be a UUID");

    // RLS would refuse the update anyway; reading first turns somebody else's
    // id into an honest 404 rather than a silent no-op.
    const item = await getWatchItem(id);
    if (!item) return notFound();

    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object") return badRequest("body must be JSON");

    const signals = normalizeSignals(item.target_type, body.signals);
    if (!signals.ok) return badRequest(signals.reason);

    const updated = await updateWatchSignals(id, signals.value);
    if (!updated) return notFound();
    return NextResponse.json({ id, signals: signals.value });
  });
}

/** Stops tracking. Deletes the saved watch and nothing else. */
export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return readRoute(async () => {
    const actor = await getActor();
    if (!actor) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
    if (!isUuid(id)) return badRequest("watch id must be a UUID");

    const removed = await deleteWatchItem(id);
    if (!removed) return notFound();
    return NextResponse.json({ id });
  });
}
