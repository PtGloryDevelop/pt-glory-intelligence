import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { resetWatchBaseline } from "@/lib/read/watchlist";
import { badRequest, notFound, readRoute } from "@/lib/read/guard";
import { getActor } from "@/lib/auth/roles";
import { isUuid } from "@/lib/read/request";

export const runtime = "nodejs";

/**
 * Moves the baseline to now.
 *
 * No timestamp is accepted from the caller. The database sets it, because a
 * backdated baseline would make old ads look new and a browser clock is not
 * something this feature can afford to trust.
 */
export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return readRoute(async () => {
    const actor = await getActor();
    if (!actor) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
    if (!isUuid(id)) return badRequest("watch id must be a UUID");

    const reset = await resetWatchBaseline(id);
    if (!reset) return notFound();
    return NextResponse.json({ id });
  });
}
