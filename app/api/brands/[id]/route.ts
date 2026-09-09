import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { updateBrand } from "@/lib/read/brands";
import { badRequest, readRoute } from "@/lib/read/guard";
import { getActor } from "@/lib/auth/roles";
import { isUuid } from "@/lib/read/request";
import {
  brandName, brandStatus, optionalText, MAX_BRAND_NOTES,
} from "@/lib/brands/contract";

export const runtime = "nodejs";

/**
 * Renames a Brand, edits its note, or archives / restores it.
 *
 * There is no DELETE. A Brand with mapping history is the record of decisions
 * people made; archiving keeps that record and stops the Brand taking new
 * Pages, which is what "we do not use this grouping any more" actually means.
 */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return readRoute(async () => {
    const actor = await getActor();
    if (!actor) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
    if (!isUuid(id)) return badRequest("brand id must be a UUID");

    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object") return badRequest("body must be JSON");

    const patch: { name?: string; notes?: string | null; status?: "active" | "archived" } = {};

    if (body.name !== undefined) {
      const name = brandName(body.name);
      if (!name.ok) return badRequest(name.reason);
      patch.name = name.value;
    }
    if (body.notes !== undefined) {
      const notes = optionalText(body.notes, MAX_BRAND_NOTES);
      if (!notes.ok) return badRequest(notes.reason);
      patch.notes = notes.value;
    }
    if (body.status !== undefined) {
      const status = brandStatus(body.status);
      if (!status) return badRequest("status must be active or archived");
      patch.status = status;
    }
    if (Object.keys(patch).length === 0) return badRequest("nothing to change");

    const updated = await updateBrand(id, patch);
    if (!updated.ok) {
      return NextResponse.json(
        { error: updated.message, duplicates: updated.duplicates ?? [] },
        { status: updated.status },
      );
    }
    return NextResponse.json({ id });
  });
}
