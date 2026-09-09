import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { createBrand, listBrands } from "@/lib/read/brands";
import { badRequest, readRoute } from "@/lib/read/guard";
import { getActor } from "@/lib/auth/roles";
import { brandName, brandStatus, optionalText, MAX_BRAND_NOTES } from "@/lib/brands/contract";
import { MAX_SEARCH_LENGTH } from "@/lib/read/request";

export const runtime = "nodejs";

/**
 * Brand search for the mapper, server-side.
 *
 * Matching is on the same normalized form the unique index uses, so what the
 * picker finds is exactly what a create would collide with. It is a text
 * search, not a suggestion: nothing here proposes a Brand for a Page.
 */
export async function GET(request: NextRequest) {
  return readRoute(async () => {
    const params = request.nextUrl.searchParams;
    const search = (params.get("search") ?? "").slice(0, MAX_SEARCH_LENGTH);
    const status = brandStatus(params.get("status")) ?? "active";
    const { rows } = await listBrands({ search: search || null, status, limit: 20 });
    return { brands: rows };
  });
}

/**
 * Creates a Brand.
 *
 * The write goes through the user's own client, so the `brands` write policy —
 * analyst or admin — is what allows it. This route validates shape only.
 *
 * A name whose normalized form already exists is refused with the existing
 * Brand attached, never merged into it: two people may legitimately mean two
 * different companies by the same words, and only a person can tell.
 */
export async function POST(request: NextRequest) {
  return readRoute(async () => {
    const actor = await getActor();
    if (!actor) return NextResponse.json({ error: "Sign in required" }, { status: 401 });

    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object") return badRequest("body must be JSON");

    const name = brandName(body.name);
    if (!name.ok) return badRequest(name.reason);
    const notes = optionalText(body.notes, MAX_BRAND_NOTES);
    if (!notes.ok) return badRequest(notes.reason);

    const created = await createBrand({
      name: name.value, notes: notes.value, actorId: actor.userId,
    });
    if (!created.ok) {
      return NextResponse.json(
        { error: created.message, duplicates: created.duplicates ?? [] },
        { status: created.status },
      );
    }
    return NextResponse.json({ id: created.value.id }, { status: 201 });
  });
}
