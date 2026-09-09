import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { actorLabel, mapPageToBrand, unmapPage } from "@/lib/read/brands";
import { badRequest, readRoute } from "@/lib/read/guard";
import { getActor } from "@/lib/auth/roles";
import { isPageId, isUuid } from "@/lib/read/request";
import { optionalText, MAX_MAPPING_NOTE } from "@/lib/brands/contract";

export const runtime = "nodejs";

/**
 * Maps a Page to a Brand — which is also how a Page moves between Brands.
 *
 * One endpoint for both, because they are one decision: the previous mapping is
 * closed and the new one opened inside a single transaction, so there is never
 * an instant where a Page has two Brands or none by accident.
 */
export async function POST(request: NextRequest) {
  return readRoute(async () => {
    const actor = await getActor();
    if (!actor) return NextResponse.json({ error: "Sign in required" }, { status: 401 });

    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object") return badRequest("body must be JSON");

    const brandId = typeof body.brandId === "string" ? body.brandId : "";
    const pageId = typeof body.pageId === "string" ? body.pageId : "";
    if (!isUuid(brandId)) return badRequest("brand id must be a UUID");
    if (!isPageId(pageId)) return badRequest("page id must be numeric");

    const note = optionalText(body.note, MAX_MAPPING_NOTE);
    if (!note.ok) return badRequest(note.reason);

    const mapped = await mapPageToBrand({
      brandId, pageId, note: note.value, actorLabel: await actorLabel(),
    });
    if (!mapped.ok) {
      return NextResponse.json({ error: mapped.message }, { status: mapped.status });
    }
    return NextResponse.json({ mappingId: mapped.value.mappingId }, { status: 201 });
  });
}

/**
 * Unmaps a Page: closes the current interval and keeps every row.
 *
 * The Page returns to the review queue. Nothing is deleted — "this was wrong"
 * is itself a decision worth keeping on the record.
 */
export async function DELETE(request: NextRequest) {
  return readRoute(async () => {
    const actor = await getActor();
    if (!actor) return NextResponse.json({ error: "Sign in required" }, { status: 401 });

    const pageId = request.nextUrl.searchParams.get("pageId") ?? "";
    if (!isPageId(pageId)) return badRequest("page id must be numeric");

    const result = await unmapPage({ pageId, actorLabel: await actorLabel() });
    if (!result.ok) {
      return NextResponse.json({ error: result.message }, { status: result.status });
    }
    return NextResponse.json({ changed: result.value.changed });
  });
}
